@echo off
REM Inicia o bot Castle/Music com captura de erros detalhada

node discord-music-bot.js
if %errorlevel% neq 0 (
    echo O bot encontrou um erro. Codigo do erro: %errorlevel%
)
pause
