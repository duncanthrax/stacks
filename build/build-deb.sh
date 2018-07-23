#!/bin/bash

pushd () {
    command pushd "$@" > /dev/null
}

popd () {
    command popd "$@" > /dev/null
}

cd $(dirname $(realpath $0))

. ./build-config

GIT_TAG=$(git log -1 --format='%cd.%h' --date=short | sed 's/-//g')

VERSION_STRING="$STACKS_VERSION"~"$GIT_TAG"-"$STACKS_REVISION"
PACKAGE_NAME="$STACKS_NAME"_"$VERSION_STRING"

echo ":: Building $PACKAGE_NAME"

sudo rm -rf $PACKAGE_NAME
mkdir -p $PACKAGE_NAME/DEBIAN
mkdir -p $PACKAGE_NAME/usr/lib/stacks/bin
mkdir -p $PACKAGE_NAME/lib/systemd/system


cat >$PACKAGE_NAME/DEBIAN/control <<END
Package: $STACKS_NAME
Version: $VERSION_STRING
Architecture: amd64
Depends: unrar, unzip, imagemagick, bash
Maintainer: Tom Kistner <tom@kistner.nu>
Description: Stacks
  CBR comic library renderer and reader
  https://github.com/duncanthrax/stacks
END

cp static/postinst $PACKAGE_NAME/DEBIAN/
cp static/prerm $PACKAGE_NAME/DEBIAN/
cp static/stacks.service $PACKAGE_NAME/lib/systemd/system/
cp static/stacks $PACKAGE_NAME/usr/lib/stacks/bin/

pushd ../meteor
meteor build ../build/$PACKAGE_NAME/usr/lib/stacks --directory
popd

mv $PACKAGE_NAME/usr/lib/stacks/bundle $PACKAGE_NAME/usr/lib/stacks/app

NODE_VERSION=$(head -1 $PACKAGE_NAME/usr/lib/stacks/app/.node_version.txt)
NODE_VERSION=${NODE_VERSION//$'\n'/}

echo ":: Downloading node $NODE_VERSION"
pushd $PACKAGE_NAME/usr/lib/stacks
curl https://nodejs.org/download/release/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.gz | tar -xz
mv node-$NODE_VERSION-linux-x64 node
popd

echo ":: Installing node modules"
pushd $PACKAGE_NAME/usr/lib/stacks/app/programs/server
../../../node/bin/node ../../../node/bin/npm install --scripts-prepend-node-path
popd

echo ":: Downloading mongodb"
curl https://fastdl.mongodb.org/linux/$STACKS_MONGODB.tgz | tar -xz
cp $STACKS_MONGODB/bin/mongod $PACKAGE_NAME/usr/lib/stacks/bin/
rm -rf $STACKS_MONGODB

echo ":: Building DEB package"
sudo chown -R 0:0 $PACKAGE_NAME
dpkg-deb --build $PACKAGE_NAME
