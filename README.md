# Stacks - CBR comic library renderer and reader
Stacks is a reader for digital comics in CBR/CBZ format. It runs as a fullscreen web application on any modern device, preferrably tablets or laptops. The server portion can be deployed on Linux (a Windows version is in preparation).

## Install on Linux
DEBs for recent systemd-based Debian variants (including Ubuntu) on amd64 are available from a BinTray repo.

Import Bintray's GPG signing key (you might have it already)
```
wget -qO - https://bintray.com/user/downloadSubjectPublicKey?username=bintray | sudo apt-key add -
```

Add this line to /etc/apt/sources.list
```
deb [arch=amd64] https://dl.bintray.com/duncanthrax/deb systemd main
```

Update, install and start. The DEB package is called "comic-stacks" because "stacks" was already taken.
```
sudo apt-get update
sudo apt-get install comic-stacks
service stacks start
```

Finally, point your browser to ```http://<IP>:4472```.

## Adding authentication and encryption
Stacks does not come with user authentication and SSL capabilities, but one or both can easily be added by fronting Stacks with nginx.
