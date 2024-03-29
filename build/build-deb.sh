#!/bin/bash

pushd () {
    command pushd "$@" > /dev/null
}

popd () {
    command popd "$@" > /dev/null
}

check_bintray () {
	RES=$(curl -L -s -o /dev/null -w "%{http_code}" "https://dl.bintray.com/duncanthrax/deb/pool/s/stacks/$PACKAGE_NAME.deb")
	echo $RES
}

cd $(dirname $(realpath $0))

. ./build-config

GIT_DATE=$(git log -1 --format="%cd" --date=short | sed 's/-//g')
STACKS_REVISION=0

while true ; do
	((STACKS_REVISION+=1))
	VERSION_STRING="$STACKS_VERSION"."$GIT_DATE"-"$STACKS_REVISION"
	PACKAGE_NAME="$STACKS_NAME"_"$VERSION_STRING"
	EXISTS=$(check_bintray "$PACKAGE_NAME")
	[[ "$EXISTS" != "200" ]] && break
done

echo ":: Building $PACKAGE_NAME"

sudo rm -rf $PACKAGE_NAME
mkdir -p $PACKAGE_NAME/DEBIAN
mkdir -p $PACKAGE_NAME/usr/lib/stacks/bin
mkdir -p $PACKAGE_NAME/lib/systemd/system
mkdir -p $PACKAGE_NAME/etc/default

cat >$PACKAGE_NAME/DEBIAN/conffiles <<END
/etc/default/stacks
END

cat >$PACKAGE_NAME/DEBIAN/control <<END
Package: $STACKS_NAME
Version: $VERSION_STRING
Architecture: amd64
Maintainer: Tom Kistner <tom@kistner.nu>
Depends: unrar, unzip, imagemagick, bash
Section: main
Priority: optional
Description: Stacks
  CBR comic library renderer and reader
  https://github.com/duncanthrax/stacks
END

# DATE=$(date -R)

# cat >$PACKAGE_NAME/DEBIAN/changelog <<END
# $STACKS_NAME ($VERSION_STRING) stretch; urgency=medium

#  * Version $VERSION_STRING

# -- Tom Kistner <tom@kistner.nu>  $DATE
# END

cp static/postinst $PACKAGE_NAME/DEBIAN/
cp static/prerm $PACKAGE_NAME/DEBIAN/
cp static/stacks.service $PACKAGE_NAME/lib/systemd/system/
cp static/stacks $PACKAGE_NAME/usr/lib/stacks/bin/
cp static/default $PACKAGE_NAME/etc/default/stacks

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
dpkg-deb --no-uniform-compression --build $PACKAGE_NAME

#if [ -r "$PACKAGE_NAME.deb" ]; then
#	echo ":: Uploading to bintray"
#	RES=$(curl -T $PACKAGE_NAME.deb -uduncanthrax:$BINTRAY_API_KEY "https://api.bintray.com/content/duncanthrax/deb/stacks/release/pool/s/stacks/"$PACKAGE_NAME".deb;deb_distribution=systemd;deb_component=main;deb_architecture=amd64;publish=1")
#	echo $RES
#	echo
#fi
