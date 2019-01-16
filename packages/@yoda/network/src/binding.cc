#include <arpa/nameser.h>
#include <netinet/in.h>
#include <resolv.h>
#include <unistd.h>
#include <errno.h>
#include <string.h>
#include <node_api.h>
#include <stdio.h>
#include <common.h>
#include <stdint.h>
#include <stdlib.h>
#include <curl/curl.h>

#define SERVER_ADDRESS  "www.taobao.com"

static int ping_net_address(char *addr) {
  char cmd[128] = {0};
  int ret = 0;
  int result = -1;
  CURL *curl;
  CURLcode res;

  sprintf(cmd, "/bin/ping -c 1 -W 3  %s > /dev/null", addr);

  ret = system(cmd);
  if (ret == 0) {
    result = 0;
  } else {
    curl = curl_easy_init();
    if (!curl) {
      return -1;
    }

    curl_easy_setopt(curl, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    curl_easy_setopt(curl, CURLOPT_URL, addr);
    curl_easy_setopt(curl, CURLOPT_NOBODY, 1);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 2L);
    curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1);

    res = curl_easy_perform(curl);

    curl_easy_cleanup(curl);

    if (res != 0) {
      result = -2;
    } else {
      result = 0;
    }
  }
  return result;
}

static napi_value NetworkState(napi_env env, napi_callback_info info) {
  int state = -1;
  napi_value returnVal;

  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, 0, 0);

  size_t addr_len = 256;
  char address[addr_len + 1];
  napi_get_value_string_utf8(env, argv[0], address, addr_len + 1, &addr_len);

  state = ping_net_address(address);
  napi_create_int32(env, state, &returnVal);

  return returnVal;
}

static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor desc[] = {
    DECLARE_NAPI_PROPERTY("networkState", NetworkState),
  };
  napi_define_properties(env, exports, sizeof(desc) / sizeof(*desc), desc);
  return exports;
}

NAPI_MODULE(network, Init)
