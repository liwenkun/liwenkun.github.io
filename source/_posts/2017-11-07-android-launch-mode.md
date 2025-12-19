---
layout:     post
title:      "Android LaunchMode 总结"
subtitle:   "Android LaunchMode 总结"
catalog:  true
date:       2017-11-07
author:     "chance"
tags:
    - Android
    - LaunchMode
---

# Android LaunchMode 总结
Android 中的 LaunchMode 是一个比较基础的知识点，关于这块之前每次都是先用现学，然后学了之后又忘了，现在把 LaunchMode 的规律记录下来以备后用。

## 需要了解的知识点
在讲 LaunchMode 之前，需要了解一下几点知识：

1. task 有属性 affinity，Activity 有属性 taskAffinity
2. 可以存在两个 affinity 一样的 task；
3. 一个 Activity 的 taskAffnity 默认值为 package name，如果有指定值就会设为指定值
<!-- more -->
## LuanchMode 规律总结

假设 FooActivity 的 taskAffinity 为 a，现在通过 Activity bar 启动 FooActivity：

- 如果 FooActivity 是 singleInstance，那么就会寻找一个 affinity 为 a 且其中的 Activity 为 FooActivity 的 task:
    - 如果能找到，就调用 task 中 FooActivity 的 onNewIntent() 方法；
    - 否则，新建一个 affinity 为 a 的 task，然后在新建的 task 中创建并启动一个 FooActivity 的实例；
- 否则，看 Activity bar 是否是 singleInstance：
    - 如果是，就会寻找一个 affinity 为 a 且其中的 Activity 不为 singleInstance 的 task。
        - 如果能找到，就看 FooActivity 的启动模式：
              - 如果 FooActivity 启动模式为 singleTop：
                  - 如果 task 栈顶为 FooActivity，就调用该 FooActivity 的 onNewIntent 方法；
                  - 否则，就在那个 task 中创建并启动一个 FooActivity 的实例；
              - 如果 FooActivity 启动模式为 singleTask:
                  - 如果 task 内存在 FooActivity，会先把该 task 中位于 FooActivity 上方的所有 Activity 清理出栈，然后调用该 FooActivity  的 onNewIntent() 方法；
                  - 否则，就在那个 task 中创建并启动一个 FooActivity 的实例；
              - 如果 FooActivity 启动模式为 standard，就在 task 中创建并启动一个 FooActivity 的实例；
        - 否则，新建一个 affinity 为 a 的 task，然后在新建的 task 中创建并启动一个 FooActivity 的实例；
    - 否则，就看 FooActivity 的启动模式：
        - 如果 FooActivity 启动模式为 singleTop，忽略 FooActivity 的 affinity 属性，直接将当前 task 作为目标 task
            - 如果 bar 的类型为 FooActivity，那么直接调用 bar 的 onNewIntent() 方法；
            - 否则，直接在当前 task 上创建并启动一个 FooActivity 的实例；
        - 如果 FooActivity 启动模式为 standard，忽略 FooActivity 的 affinity 属性，直接在当前 task 上创建并启动一个 FooActivity 的实例；
        - 如果 FooActivity 启动模式为 singleTask，就会寻找一个 affinity 为 a 且其中的 Activity 不为 singleInstance 的 task：
            - 如果能找到：
                - 如果 task 栈内有 FooActivity，会先把该 task 中位于 FooActivity 上方的所有 Activity 清理出栈，然后调用该 FooActivity  的 onNewIntent() 方法；
                - 否则就在那个 task 中创建并启动一个 FooActivity 的实例；
            - 否则，新建一个 affinity 为 a 的 task，然后在新建的 task 中创建并启动一个 FooActivity 的实例；
        
## 总结
关于 LaunchMode，光靠阅读文章是不能深刻理解其中规律的。大家可以尝试自己写一些各种启动模式的 Activity，让他们相互启动，再通过 adb shell dumpsys 这个命令查看任务栈以及其中的 Activity，这样应该能很快理解 LaunchMode 的规律的，也能记得更牢。
