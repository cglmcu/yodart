cmake_minimum_required(VERSION 3.0)
project(node-network CXX)
set(CMAKE_CXX_STANDARD 11)

add_library(node-network MODULE src/binding.cc)
target_include_directories(node-network PRIVATE
  ../../../include
  ${CMAKE_INCLUDE_DIR}/include
  ${CMAKE_INCLUDE_DIR}/usr/include
  ${CMAKE_INCLUDE_DIR}/usr/include/shadow-node
)

target_link_libraries(node-network iotjs curl)
set_target_properties(node-network PROPERTIES
  PREFIX ""
  SUFFIX ".node"
  OUTPUT_NAME "network"
  LINK_FLAGS "-rdynamic")

install(TARGETS node-network DESTINATION ${CMAKE_INSTALL_DIR})
install(FILES index.js DESTINATION ${CMAKE_INSTALL_DIR})

