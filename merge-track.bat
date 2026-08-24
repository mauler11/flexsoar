@echo off
if "%1"=="" echo Usage: merge-track <data|design|admin|market>
if "%1"=="" exit /b 
git log main..track/%1 --oneline && git merge track/%1 && npm i && npm test && npm run build
