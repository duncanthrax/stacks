@echo off

REM https://stackoverflow.com/questions/33829284/deploy-meteor-on-windows

rd winbuild /S /Q
mkdir winbuild
cd ..\meteor

CALL demeteorizer -o ..\build\winbuild

cd ..\build\winbuild
rename bundle meteor
mkdir db
echo MongoDB > db\MongoDB

cd meteor\programs\server

CALL npm install

cd ..\..\..

where node.exe > tmpFile
SET /p nodeexe= < tmpFile
DEL tmpFile

copy "%nodeexe%" .
copy ..\..\windows\binaries\mongod.exe .
copy ..\..\windows\launcher\bin\Release\StacksLauncher.exe .

