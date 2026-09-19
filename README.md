# BioPrint — log in with the way you type and move

Behavior-based login security. A normal username/password form is observed from the moment it renders: keystroke rhythm, the pointer's path to the button, the click, and the pauses between them. The password is verified separately and deleted before the behavioral engine sees the request. If the behavior does not match the account's enrolled profile, the login is blocked or challenged, with no OTP fallback. Scripted, bot-driven and replayed logins are flagged as a **separate fraud signal** and blocked outright.

Zero dependencies. Node 24+ built-ins only (HTTP, SQLite, crypto). Decisions take single-digit milliseconds, and every one comes with a plain-English explanation.
