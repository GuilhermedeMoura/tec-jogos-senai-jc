@echo off
REM Script para completar a configuração do Firebase Storage

echo.
echo ========================================
echo  Firebase Storage - Configuracao
echo ========================================
echo.

echo Attempting to deploy Firebase Storage rules...
echo.

npx firebase-tools deploy --only storage

echo.
if %errorlevel% equ 0 (
    echo ✓ Firebase Storage foi configurado com sucesso!
    echo.
    echo Sua plataforma de jogos esta pronta para:
    echo  - Fazer upload de jogos
    echo  - Armazenar arquivos ZIP e HTML
    echo  - Compartilhar jogos na web
    echo.
    echo Acesse: https://tec-jogos-senai-jc.web.app
) else (
    echo X Houve um erro na configuracao.
    echo.
    echo Para ativar manualmente:
    echo 1. Acesse https://console.firebase.google.com/project/tec-jogos-senai-jc/storage
    echo 2. Clique em "Get Started"
    echo 3. Selecione um local de armazenamento
    echo 4. Clique em "Criar"
)

pause
