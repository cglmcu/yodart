#!/usr/bin/env bash

OLD_DIR=`pwd`
DEVICE_ID=""

init() {
  NEW_DIR="$(cd "$(dirname "$0")"; pwd)"
  cd $NEW_DIR
  echo "switch to the dir: $NEW_DIR"
}

deinit() {
  cd $OLD_DIR
  echo "resume to the dir: ${OLD_DIR}"
}

read_args() {
  FILENAME=$1; SECTION=$2; KEY=$3
  DEVICE_ID=`awk -F '=' '/\['$SECTION'\]/{a=1}a==1&&$1~/'$KEY'/{print $2;exit}' $FILENAME`
  DEVICE_ID=`echo $DEVICE_ID|awk '{print $1}'`
  echo "DEVICE_ID is $DEVICE_ID"
}

read_info() {
  local props=""
  if [ ! $DEVICE_ID ]; then
    props=`adb shell getprop`
  else
    props=`adb -s $DEVICE_ID shell getprop`
  fi

  echo "$props" | grep "ro.boot.serialno"
  echo "$props" | grep "ro.build.version.release"
  echo "$props" | grep "ro.rokid.build.productname"
  echo "$props" | grep "ro.rokid.build.yodaos"
  echo "$props" | grep "ro.boot.hardware"
}

print_head() {
  echo "************************ $@ ***********************"
}

init
# read_args "config.ini" "device" "deviceID"
echo "************************ Device information ***********************"
read_info

deinit
