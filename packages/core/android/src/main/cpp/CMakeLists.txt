cmake_minimum_required(VERSION 3.22.1)
project(nativue CXX)

find_package(hermes-engine REQUIRED CONFIG)

# Hermes links against a libjsi.so it doesn't ship.
add_library(jsi SHARED jsi/jsi/jsi.cpp)
target_include_directories(jsi PUBLIC jsi)

add_library(nativue SHARED bridge.cpp)
target_link_libraries(nativue hermes-engine::hermesvm jsi log)
