# UGF Telegram — Termux se GitHub par push + APK

## 1. GitHub par khaali repo banao (browser mein)
github.com -> New repository -> naam: `ugf-telegram` -> Create (README mat jodna).

## 2. GitHub token banao
GitHub -> Settings -> Developer settings -> Personal access tokens -> Tokens (classic)
-> Generate new token -> tick: `repo` aur `workflow` -> copy kar lo.

## 3. Termux mein
```
pkg update -y && pkg install -y git unzip
termux-setup-storage
cd ~
unzip ~/storage/downloads/ugf-telegram.zip     # zip jahan save hai wahan ka path
cd ugf-telegram
git init -b main
git config user.name  "TumharaNaam"
git config user.email "sumitlord17@gmail.com"
git add .
git commit -m "UGF Telegram app"
git remote add origin https://github.com/TUMHARA_USERNAME/ugf-telegram.git
git push -u origin main
```
Username maangne par GitHub username, password ki jagah **token** paste karo.

## 4. APK lena
Push hote hi GitHub par build chalu ho jaata hai (5-8 min).
Repo -> **Actions** tab mein hara tick aaye -> repo ke **Releases** (right side) mein
`UGF-Telegram.apk` hai -> phone se download -> install (Unknown sources allow karna padega).

## 5. App mein
Telegram web khulega, login karo. Right side ek chhota tiger logo dikhega (drag karke
kahin bhi rakh sakte ho). Logo par tap -> extension panel khulega. Mic permission "Allow" karna.
Voice call/voice chat/voice message mein awaaz extension se hoke jaayegi.
