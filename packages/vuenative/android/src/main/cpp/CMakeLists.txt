cmake_minimum_required(VERSION 3.22.1)
project(vuenative CXX)

find_package(hermes-engine REQUIRED CONFIG)

# Hermes links against a libjsi.so it doesn't ship.
add_library(jsi SHARED jsi/jsi/jsi.cpp)
target_include_directories(jsi PUBLIC jsi)

add_library(vuenative SHARED bridge.cpp)
target_link_libraries(vuenative hermes-engine::hermesvm jsi log)
