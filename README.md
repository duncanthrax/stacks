# Stacks - CBR comic library renderer and reader
Stacks is a reader for digital comics in CBR/CBZ format. It runs as a fullscreen web application on any modern device, preferrably tablets or laptops. The server portion can be deployed on Linux (a Windows version is in preparation).

![](doc/screenshot-1.png)

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
sudo service stacks start
```

Point your browser to ```http://<IP>:4472```. On successful load, you should see your still empty library. Click the settings (wrench) icon in the top right corner. Specify the path to your comic library. Click "Apply and redo initial scan" to let Stacks read your comic library.

## Using stacks
Navigation on the stacks and book screens should be more or less obvious. The reader can either be controlled with mouse buttons and scroll wheel (on desktops) or by tapping screen edges and corners (tablets/touch screens).

### Reader mouse controls (for desktops)
![](doc/mouse.png)

### Reader touch controls
![](doc/touch.png)

## Adding authentication and encryption
Stacks does not come with user authentication and SSL capabilities, but one or both can easily be added by fronting Stacks with nginx.
