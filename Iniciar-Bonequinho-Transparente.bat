@echo off
cd /d "%~dp0"
echo Iniciando o Bonequinho Transparente na Barra de Tarefas (Pocket Corner)...
start "" npx electron electron/main.cjs
