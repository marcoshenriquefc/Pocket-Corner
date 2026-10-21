// Híbrido:
// 1. PiP Zero-Bordas via Navegador (Canvas Stream Video PiP - sem barra de título!)
// 2. Document Picture-in-Picture Interativo Sem Bordas Internas (Web API)
// 3. Overlay Nativo 100% Transparente acionado por botão no navegador (sem terminal!)

interface DocumentPictureInPicture {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
}

interface PocketDesktopAPI {
  isDesktopOverlay: boolean;
  setIgnoreCursorEvents: (ignore: boolean) => void;
  dockToCorner: (corner: 'bottom-left' | 'bottom-center' | 'bottom-right') => void;
  setPopupExpanded?: (expanded: boolean) => void;
  openFullHub: () => void;
  closeOverlay: () => void;
}

declare global {
  interface Window {
    documentPictureInPicture?: DocumentPictureInPicture;
    pocketDesktop?: PocketDesktopAPI;
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
  }
}

export function getApiBaseUrl(): string {
  const custom = localStorage.getItem('pc_server_url')?.trim();
  if (custom) return custom.replace(/\/+$/, '');
  const envUrl = (import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env
    ?.VITE_SERVER_URL;
  if (envUrl && envUrl.trim()) return envUrl.trim().replace(/\/+$/, '');
  return '';
}

export class WindowBridge {
  public isNativeTauri = false;
  public isElectronOverlay = false;
  public isDesktopWidgetMode = false;
  public isTransparentOverlay = false;
  public isBrowserCornerDocked = false;
  public pipWindow: Window | null = null;
  public videoPipActive = false;

  private pipVideoEl: HTMLVideoElement | null = null;
  private lastIgnoreCursorState: boolean | null = null;
  private onModeChangeCallbacks: Array<() => void> = [];

  constructor() {
    this.isNativeTauri = Boolean(
      typeof window !== 'undefined' && (window.__TAURI_INTERNALS__ || window.__TAURI__)
    );
    this.isElectronOverlay = Boolean(
      typeof window !== 'undefined' && window.pocketDesktop?.isDesktopOverlay
    );

    const params = new URLSearchParams(window.location.search);
    const hasDesktopParam = params.get('desktop') === '1';

    this.isDesktopWidgetMode =
      this.isNativeTauri || this.isElectronOverlay || hasDesktopParam;

    if (this.isDesktopWidgetMode) {
      this.isTransparentOverlay = true;
      document.documentElement.classList.add(
        'tauri-transparent-mode',
        'desktop-widget-only'
      );
    }
  }

  public onModeChange(cb: () => void) {
    this.onModeChangeCallbacks.push(cb);
  }

  private notifyModeChange() {
    for (const cb of this.onModeChangeCallbacks) cb();
  }

  public toggleTransparentOverlay(force?: boolean): boolean {
    if (!this.isDesktopWidgetMode) {
      this.isTransparentOverlay = false;
      document.documentElement.classList.remove('tauri-transparent-mode');
      this.notifyModeChange();
      return false;
    }
    this.isTransparentOverlay =
      typeof force === 'boolean' ? force : !this.isTransparentOverlay;
    if (this.isTransparentOverlay) {
      document.documentElement.classList.add('tauri-transparent-mode');
    } else {
      document.documentElement.classList.remove('tauri-transparent-mode');
      this.setClickThrough(false);
    }
    this.notifyModeChange();
    return this.isTransparentOverlay;
  }

  /**
   * Fixa o Cantinho no canto inferior direito da janela mantendo o tema escuro e botão de retorno visível
   */
  public toggleBrowserCornerDock(force?: boolean): boolean {
    this.isBrowserCornerDocked =
      typeof force === 'boolean' ? force : !this.isBrowserCornerDocked;
    if (this.isBrowserCornerDocked) {
      document.documentElement.classList.add('browser-corner-docked');
    } else {
      document.documentElement.classList.remove('browser-corner-docked');
    }
    this.notifyModeChange();
    return this.isBrowserCornerDocked;
  }

  /**
   * 100% via Navegador SEM BARRA DE TÍTULO E SEM BORDAS:
   * Usa canvas.captureStream(60) + HTMLVideoElement.requestPictureInPicture()
   * O navegador cria uma janelinha flutuante pura (zero barra de endereço, zero barra de título)
   * que fica sempre no topo sobre a barra de tarefas!
   */
  public async toggleBorderlessVideoPiP(canvas: HTMLCanvasElement): Promise<boolean> {
    if (document.pictureInPictureElement) {
      await document.exitPictureInPicture();
      this.videoPipActive = false;
      this.notifyModeChange();
      return false;
    }

    if (!this.pipVideoEl) {
      this.pipVideoEl = document.createElement('video');
      this.pipVideoEl.muted = true;
      this.pipVideoEl.playsInline = true;
      this.pipVideoEl.style.position = 'fixed';
      this.pipVideoEl.style.width = '1px';
      this.pipVideoEl.style.height = '1px';
      this.pipVideoEl.style.opacity = '0';
      this.pipVideoEl.style.pointerEvents = 'none';
      document.body.appendChild(this.pipVideoEl);

      this.pipVideoEl.addEventListener('leavepictureinpicture', () => {
        this.videoPipActive = false;
        this.notifyModeChange();
      });
    }

    const stream = canvas.captureStream(60);
    this.pipVideoEl.srcObject = stream;
    await this.pipVideoEl.play();
    await this.pipVideoEl.requestPictureInPicture();
    this.videoPipActive = true;
    this.notifyModeChange();
    return true;
  }

  /**
   * Aciona o bonequinho 100% transparente na barra de tarefas do Windows
   * diretamente por um clique no navegador (sem precisar abrir terminal!)
   */
  public async toggleNativeTaskbarFromBrowser(
    username?: string
  ): Promise<{ active: boolean; message: string }> {
    const base = getApiBaseUrl();
    const res = await fetch(`${base}/api/desktop/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    const data = (await res.json()) as { active: boolean; message?: string; error?: string };
    if (!res.ok) {
      throw new Error(data.error || 'Este recurso requer execução local no PC.');
    }
    return { active: data.active, message: data.message || '' };
  }

  public async setClickThrough(ignore: boolean): Promise<void> {
    if (this.lastIgnoreCursorState === ignore) return;
    this.lastIgnoreCursorState = ignore;

    if (this.isElectronOverlay && window.pocketDesktop) {
      window.pocketDesktop.setIgnoreCursorEvents(ignore);
      return;
    }

    if (this.isNativeTauri) {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const appWin = getCurrentWindow();
        await appWin.setIgnoreCursorEvents(ignore);
      } catch {
        // Ignore in standard browser
      }
    }
  }

  public dockToCorner(corner: 'bottom-left' | 'bottom-center' | 'bottom-right') {
    if (this.isElectronOverlay && window.pocketDesktop) {
      window.pocketDesktop.dockToCorner(corner);
    }
  }

  public setPopupExpanded(expanded: boolean) {
    if (this.isElectronOverlay && window.pocketDesktop?.setPopupExpanded) {
      window.pocketDesktop.setPopupExpanded(expanded);
    }
  }

  public openFullHub() {
    if (this.isElectronOverlay && window.pocketDesktop) {
      window.pocketDesktop.openFullHub();
    } else {
      window.open(window.location.origin, '_blank');
    }
  }

  /**
   * Document Picture-in-Picture API (Interativo, sem bordas internas, controles auto-ocultos)
   */
  public async togglePictureInPicture(
    widgetElement: HTMLElement,
    placeholderContainer: HTMLElement
  ): Promise<{ active: boolean; mode: 'pip' | 'inline' }> {
    if (this.pipWindow && !this.pipWindow.closed) {
      this.pipWindow.close();
      this.pipWindow = null;
      placeholderContainer.appendChild(widgetElement);
      widgetElement.classList.remove('in-pip-window');
      this.notifyModeChange();
      return { active: false, mode: 'inline' };
    }

    if (window.documentPictureInPicture) {
      try {
        const pipWin = await window.documentPictureInPicture.requestWindow({
          width: 360,
          height: 180,
        });

        this.pipWindow = pipWin;
        pipWin.document.title = ' ';

        Array.from(document.styleSheets).forEach((styleSheet) => {
          try {
            const cssRules = Array.from(styleSheet.cssRules)
              .map((rule) => rule.cssText)
              .join('\n');
            const style = pipWin.document.createElement('style');
            style.textContent = cssRules;
            pipWin.document.head.appendChild(style);
          } catch {
            if (styleSheet.href) {
              const link = pipWin.document.createElement('link');
              link.rel = 'stylesheet';
              link.href = styleSheet.href;
              pipWin.document.head.appendChild(link);
            }
          }
        });

        pipWin.document.documentElement.style.background = 'transparent';
        pipWin.document.body.style.margin = '0';
        pipWin.document.body.style.padding = '0';
        pipWin.document.body.style.background = 'transparent';
        pipWin.document.body.style.overflow = 'hidden';
        pipWin.document.body.classList.add('pip-body-root');

        widgetElement.classList.add('in-pip-window');
        pipWin.document.body.appendChild(widgetElement);

        pipWin.addEventListener('pagehide', () => {
          this.pipWindow = null;
          widgetElement.classList.remove('in-pip-window');
          placeholderContainer.appendChild(widgetElement);
          this.notifyModeChange();
        });

        this.notifyModeChange();
        return { active: true, mode: 'pip' };
      } catch (err) {
        console.warn('[WindowBridge] Document PiP failed:', err);
      }
    }

    throw new Error(
      'Document Picture-in-Picture API não disponível neste navegador.'
    );
  }
}

export const windowBridge = new WindowBridge();
