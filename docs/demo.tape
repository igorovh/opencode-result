# Demo for the README: vhs docs/demo.tape
#
# Uses only fake data. Before recording, prepare a throwaway OpenCode setup:
# - DEMO_ROOT: folder with home/ (fake HOME) and xdg/{config,data,state,cache}
# - xdg/config/opencode/opencode.json: { "plugins": ["github:igorovh/opencode-result#v0.2.0"] }
# - home/demo/acme-web: a small git repo
# - DEMO_SESSION: a session in that repo (POST /api/session through `opencode api`) with reports
#   saved under xdg/data/opencode/result/<session>/ by the plugin's Store

Output docs/demo.gif

Set Shell "powershell"
Set FontSize 15
Set Width 1600
Set Height 860
Set Padding 12
Set Framerate 12
Set TypingSpeed 60ms
Set Theme "Catppuccin Mocha"

Hide
Type `$r = $env:DEMO_ROOT; $env:HOME = "$r\home"; $env:USERPROFILE = $env:HOME; foreach ($d in 'CONFIG','DATA','STATE','CACHE') { Set-Item "env:XDG_$($d)_HOME" "$r\xdg\$($d.ToLower())" }`
Enter
Type `if (Get-Command opencode2 -ErrorAction SilentlyContinue) { Set-Alias opencode opencode2 }; cd $env:HOME\demo\acme-web; function prompt { '> ' }; cls`
Enter
Type `opencode -s $env:DEMO_SESSION`
Enter
Sleep 9s
Show

# The Results section in the sidebar.
Sleep 2.5s

# /results lists the session's reports; Enter opens the newest one.
Type "/results"
Sleep 800ms
Enter
Sleep 2s
Enter
Sleep 3.5s

# Jump through sections with n, then page down.
Type "n"
Sleep 1.5s
Type "n"
Sleep 2s
Type "n"
Sleep 1.5s
Space
Sleep 2.5s

# esc goes back to the list, and esc again to the session.
Escape
Sleep 2s
Escape
Sleep 1.5s
