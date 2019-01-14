#!/usr/bin/env bash

echo "Project download address:" `pwd`

#
# Requires the following envs
#
# - COVERAGE_ENABLED
# - WORKSPACE
#

COVERAGE_RAW_PATH=".nyc_output"

discovery_config() {
  echo "copy config.json from ~/.yodaci/config.json"
  cp -rf ~/.yodaci/config.json ./test/config.json
  if [ "$?" != 0 ];then
    echo "config discovery failed, exit now"
    exit 1
  fi
}

clean() {
  rm -rf ./test/config.json
}

init_device() {
  # TODO: check if the os image is mountable and support multi devices.
  adb shell mount -o remount -o rw /
  adb shell rm -rf /data/${COVERAGE_RAW_PATH}
}

init() {
  echo "init the test runner environment."
  cd $WORKSPACE
  rm -rf ./node_modules
  npm install
  npm install tap-html codecov

  # remove coverage dirs
  rm -rf ./coverage
  rm -rf ./$COVERAGE_RAW_PATH
  rm -rf .src-prepare
  rm -rf .src-coverage
  
  init_device
  ./tools/runtime-install -t
  if [ "$?" != 0 ];then
    echo "===========init fail========="
    exit 1
  fi
}

print_info() {
  echo "\033[32m $@ \033[0m"
}

print_warn() {
  echo "\033[33m $@ \033[0m"
}

print_error() {
  echo "\033[31m $@ \033[0m"
}

foreach_unit_tests() {
  local num=0
  local flag=0
  local failList=()
  local dirs=$1

  for dir in $dirs;
  do

  done
}

run_unit_tests() {
  echo "run unit tests"
  sleep 5

  local dirs=`python ./get_dirs.py $WORKSPACE`
  for t in $dirs;
  do     
    print_warn ${t}
  done

  echo "unit test workplace:" `pwd`
  echo "coverage path is:" ${COVERAGE_RAW_PATH}
  foreach_unit_tests $dirs
}

run_tests() {
  echo "start running"
  if [ ${COVERAGE_ENABLED} == false ]; then

  fi


  sh ./coverage/main.sh
  if [ "$?" != 0 ];then
     echo "test failed, exit and clean config now"
     clean_config
     exit 1
  fi
}

discovery_config
run_tests
clean
