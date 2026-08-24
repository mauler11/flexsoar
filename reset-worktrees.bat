@echo off
for %%d in (data design admin market) do @git -C C:\Users\Family\flexsoar-%%d log main..track/%%d --oneline
echo.
echo If any commits printed above, press Ctrl+C NOW. Enter resets over them.
pause
for %%d in (data design admin market) do @git -C C:\Users\Family\flexsoar-%%d reset --hard main
