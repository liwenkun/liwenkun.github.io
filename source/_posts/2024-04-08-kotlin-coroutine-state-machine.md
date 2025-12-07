---
layout:     post
title:      探究 Kotlin 协程
subtitle:  
date:       2024-04-08
author:     "Chance"
catalog:  true
tags:
    - Kotlin
    - 协程
---

# 前言

Kotlin 中的协程是无栈协程（话说 Kotlin 能实现有栈线程吗🤔），网上很多文章都说无栈协程一般都是通过状态机实现的，刚开始听到这个状态机的时候觉得有点玄乎，今天打算利用反编译工具并结合协程库源码，来探究一下 Kotlin 协程实现原理。

# 从一个简单的示例开始

```kotlin
fun main() {
    runBlocking {
        val result = fun1()
        println(result)
    }
}

suspend fun fun1(): Int {
    var localInt = 0
    localInt += fun2()
    localInt += fun3()
    return localInt
}

suspend fun fun2(): Int = 1

suspend fun fun3(): Int {
    delay(1000)
    return 1
}
```

<!--more-->

以上代码通过 `runBlocking()`​ 开启协程，协程调用 `fun1()`​ ，然后打印结果。`fun1()`​ 是一个 `suspend`​ 方法，它定义了一个局部变量 `localInt`​，然后依次执行了 `fun2()`​ 和 `fun3()`​ 并将二者结果累加到 `localInt`​ 中，最后将 `localInt`​ 返回。`fun2()`​ 是一个普通方法,`fun3()`​ 内调用了 `delay()`​，`delay()`​ 是协程库提供的 `suspend`​方法。

下面我们将会从 `runBlocking()`​ 开始，揭开 Kotlin 协程的神秘面纱。

## Builders#runBlocking

```kotlin
public actual fun <T> runBlocking(context: CoroutineContext, block: suspend CoroutineScope.() -> T): T {
    contract {
        callsInPlace(block, InvocationKind.EXACTLY_ONCE)
    }
    val currentThread = Thread.currentThread()
    val contextInterceptor = context[ContinuationInterceptor]
    val eventLoop: EventLoop?
    val newContext: CoroutineContext
    if (contextInterceptor == null) {
        // create or use private event loop if no dispatcher is specified
        eventLoop = ThreadLocalEventLoop.eventLoop
        newContext = GlobalScope.newCoroutineContext(context + eventLoop)
    } else {
        // See if context's interceptor is an event loop that we shall use (to support TestContext)
        // or take an existing thread-local event loop if present to avoid blocking it (but don't create one)
        eventLoop = (contextInterceptor as? EventLoop)?.takeIf { it.shouldBeProcessedFromContext() }
            ?: ThreadLocalEventLoop.currentOrNull()
        newContext = GlobalScope.newCoroutineContext(context)
    }
    val coroutine = BlockingCoroutine<T>(newContext, currentThread, eventLoop)
    coroutine.start(CoroutineStart.DEFAULT, coroutine, block)
    return coroutine.joinBlocking()
}
```

这个方法的逻辑非常清晰：

- 5 ~ 19 行用来构建协程的上下文，协程上下文是一些元素的集合，包括拦截器，代表协程的任务，异常处理器，协程名称等。
- 20 行 `BlockingCoroutine<T>(newContext, currentThread, eventLoop)`​构建协程对象
- 21 行 `coroutine#start()`​ 启动协程
- 22 行阻塞当前线程，直到协程结束。

只要搞懂了 `BlockingCotoutine`​ 和 `coroutine#start()`​，就能对 Kotlin 协程的实现原理有一个大致的了解。为了便于理解，我们先从  `Coroutine#Start()`​ 着手。

## Coroutine#Start

省略一些中间过程，`Coroutine#Start`​ 最后会调用到下面这个方法：

### CoroutineStarter#invoke

```kotlin
public operator fun <R, T> invoke(block: suspend R.() -> T, receiver: R, completion: Continuation<T>): Unit =
        when (this) {
            DEFAULT -> block.startCoroutineCancellable(receiver, completion)
            ATOMIC -> block.startCoroutine(receiver, completion)
            UNDISPATCHED -> block.startCoroutineUndispatched(receiver, completion)
            LAZY -> Unit // will start lazily
        }
```

协程有多种启动模式，简单起见，我们只研究 `DEFAULT`​ 模式，其他分支原理大同小异。`block.startCoroutineCancellable()`​ 源码如下：

### Cancellable#startCoroutineCancellable

```kotlin
/**
 * Use this function to start coroutine in a cancellable way, so that it can be cancelled
 * while waiting to be dispatched.
 */
internal fun <R, T> (suspend (R) -> T).startCoroutineCancellable(
    receiver: R, completion: Continuation<T>,
    onCancellation: ((cause: Throwable) -> Unit)? = null
) =
    runSafely(completion) {
        createCoroutineUnintercepted(receiver, completion).intercepted().resumeCancellableWith(Result.success(Unit), onCancellation)
    }
```

重点是 `createCoroutineUnintercepted()`​：

### IntrinsicsJvm#createCoroutineUnintercepted

```kotlin
@SinceKotlin("1.3")
public actual fun <R, T> (suspend R.() -> T).createCoroutineUnintercepted(
    receiver: R,
    completion: Continuation<T>
): Continuation<Unit> {
    val probeCompletion = probeCoroutineCreated(completion)
    return if (this is BaseContinuationImpl)
        create(receiver, probeCompletion)
    else {
        createCoroutineFromSuspendFunction(probeCompletion) {
            (this as Function2<R, Continuation<T>, Any?>).invoke(receiver, it)
        }
    }
}
```

一般来说代码会走到 if 分支。if 分支调用了 suspend block 的 `create()`​ 方法。这个方法是编译器为 suspend lambda 生成的。接下来我们需要反编译示例代码来进一步探究。

<p class="notice-info">反编译 Kotlin 代码是没法使用传统的反编译工具来完成的，需要在 IDEA 中打开 Kotlin 字节码文件，然后点击 工具 -> Kotlin -> 反编译为  Java 来完成。</p>

## main

先看 `main`​ 方法的反编译结果：

```java
public static final void main() {
      BuildersKt.runBlocking$default((CoroutineContext)null, (Function2)(new Function2((Continuation)null) {
         int label;

         @Nullable
         public final Object invokeSuspend(@NotNull Object $result) {
            Object var3 = IntrinsicsKt.getCOROUTINE_SUSPENDED();
            Object var10000;
            switch (this.label) {
               case 0:
                  ResultKt.throwOnFailure($result);
                  Continuation var4 = (Continuation)this;
                  this.label = 1;
                  var10000 = TestKt.fun1(var4);          // fun1()
                  if (var10000 == var3) {
                     return var3;
                  }
                  break;
               case 1:
                  ResultKt.throwOnFailure($result);
                  var10000 = $result;
                  break;
               default:
                  throw new IllegalStateException("call to 'resume' before 'invoke' with coroutine");
            }

            int result = ((Number)var10000).intValue();
            System.out.println(result);
            return Unit.INSTANCE;
         }

         @NotNull
         public final Continuation create(@Nullable Object value, @NotNull Continuation $completion) {
            return (Continuation)(new <anonymous constructor>($completion));
         }

         @Nullable
         public final Object invoke(@NotNull CoroutineScope p1, @Nullable Continuation p2) {
            return ((<undefinedtype>)this.create(p1, p2)).invokeSuspend(Unit.INSTANCE);
         }

         // $FF: synthetic method
         // $FF: bridge method
         public Object invoke(Object p1, Object p2) {
            return this.invoke((CoroutineScope)p1, (Continuation)p2);
         }
      }), 1, (Object)null);
   }
```

​`runBlocking$default()`​ 是 `runBlocking()`​ 的反编译后的名字。反编译后的代码中，它接收四个参数，后面两个参数暂时不用理会。第一个参数类型为 `CoroutineContext`​，传入的是 `null`​。第二个参数是一个 `Function2`​ 对象，`Function2`​ 是 Kotlin 库中的一个接口，定义如下：

```kotlin
public interface Function2<in P1, in P2, out R> : Function<R> {
    /** Invokes the function with the specified arguments. */
    public operator fun invoke(p1: P1, p2: P2): R
}
```

Kotlin 编译器用 `Function1`​，`Function2`​ ... `FuncitonX`​  接口来实现 lambda 表达式，Function 后面的数字表示 lambda 参数的数量。如果 lambda 有 receiver，receiver 会被视为其第一个参数，则 `invoke()`​ 的第一个参数为 receiver，后续参数为 lambda 的实际参数。例如，lambda 表达式  `val a: Int.(Int, Int) -> Int = { x: Int, y: Int -> this + x + y }`​ 会用以下代码来实现：

```java
Function3 a =  new Function3<Integer, Integer, Integer, Object> {
    /** Invokes the function with the specified arguments. */
    public final Object invoke(Integer p1, Integer p2, Integer p3) {
		return p1 + p2 + p3;
	}
}
```

对于 suspend lambda，实现则略有不同，例如对于一个空的 lambda： `val a: suspend () -> Unit = {}`​，实际上生成的对象通常长这样的：

```java
class _SuspendLambda extends SuspendLambda implements Function1<Object> {

    public final Object invokeSuspend(Object result) {
		 /* lambda 函数体逻辑，省略 */
    }

    public _SuspendLambda(Continuation completion) {
		super(0 /* 这个值具体是多少不知道，也不重要，我这里是乱写的 */, completion):
	}
    /** Invokes the function with the specified arguments. */
    public final Object invoke(Continuation completion) {
		return this.create(completion).invokeSuspend(completion)
	}

    public Object invoke(Object p1) {
        return this.invoke((Continuation)p2);
    }
		
    public final Continuation create(completion: Continuation) {
         return AnnoymousClass(completion));
    } 
}
```

Kotlin 会为每一个 suspend lambda 生成一个继承 `SuspendLambda`​ 并实现 `FunctionX`​ 接口的匿名类，并且还给它添加了一个 `Cotinuation`​ 类型的参数（这个参数具体什么含义，我们后面会讲）。此外，编译器还会为它额外生成 `invokeSuspend()`​ ，`create()`​ 和 `invoke()`​ 这三个方法。`invokeSuspend()`​ 中包含的是 lambda 函数体的逻辑，`create()`​ 则是用来创建该类的一个新实例，`invoke()`​ 重载方法貌似有点多余，只是对参数类型具体化了一下而已。

我们现在回过头来看 `runBlocking`​ 的 suspned lambda 参数反编译后的代码：

```java
new Function2((Continuation)null) {
         int label;

         @Nullable
         public final Object invokeSuspend(@NotNull Object $result) {
            Object var3 = IntrinsicsKt.getCOROUTINE_SUSPENDED();
            Object var10000;
            switch (this.label) {
               case 0:
                  ResultKt.throwOnFailure($result);
                  Continuation var4 = (Continuation)this;
                  this.label = 1;
                  var10000 = TestKt.fun1(var4);          // fun1()
                  if (var10000 == var3) {
                     return var3;
                  }
                  break;
               case 1:
                  ResultKt.throwOnFailure($result);
                  var10000 = $result;
                  break;
               default:
                  throw new IllegalStateException("call to 'resume' before 'invoke' with coroutine");
            }

            int result = ((Number)var10000).intValue();
            System.out.println(result);
            return Unit.INSTANCE;
         }

         @NotNull
         public final Continuation create(@Nullable Object value, @NotNull Continuation $completion) {
            return (Continuation)(new <anonymous constructor>($completion));
         }

         @Nullable
         public final Object invoke(@NotNull CoroutineScope p1, @Nullable Continuation p2) {
            return ((<undefinedtype>)this.create(p1, p2)).invokeSuspend(Unit.INSTANCE);
         }

         // $FF: synthetic method
         // $FF: bridge method
         public Object invoke(Object p1, Object p2) {
            return this.invoke((CoroutineScope)p1, (Continuation)p2);
         }
   }
```

它便是编译器为我们生成的 `SuspendLambda` 匿名子类对象，后续我会用 `_SuspendLambda`​ 表示这个匿名子类。

<p class="notice-info">反编译器没能展示出这个匿名类和 SuspendLambda 的继承关系，但可以通过在 runBlocking() 添加断点得知 suspend lambda 最终确实被编译成了 SuspendLambda 的一个匿名子类。</p>

细心的你会发现不一样的地方，就是 `invoke()`​ 多了一个类型为 `CoroutineScope`​ 的参数。这是因为 `runBlocking()`​ 的 suspend lambda 参数有 receiver，前面讲过，如果 lambda 有 receiver， receiver 会被视为 lambda 的第一个参数。

回过头看看 `createCoroutineUnintercepted`​：

```java
@SinceKotlin("1.3")
public actual fun <R, T> (suspend R.() -> T).createCoroutineUnintercepted(
    receiver: R,
    completion: Continuation<T>
): Continuation<Unit> {
    val probeCompletion = probeCoroutineCreated(completion)
    return if (this is BaseContinuationImpl)
        create(receiver, probeCompletion)
    else {
        createCoroutineFromSuspendFunction(probeCompletion) {
            (this as Function2<R, Continuation<T>, Any?>).invoke(receiver, it)
        }
    }
}
```

​`this`​ 是 suspend lambda，前面说了，它是一个 `_SuspendLambda`​ 对象，而 `_SuspendLambda`​ 的继承链是：`_SuspendLambda`​ -> `SuspendLambda` -> `ContinuationImpl`​ -> `BaseContinuationImpl`​ -> `Continuation`​，因此代码会进入 `if`​ 分支。`if`​ 分支很简单，就是调用 `_SuspendLambda` 的 `create()`​ 方法来生成该类的一个新实例，前面说过，`create()` 方法是编译器为 `_SuspendLambda` 生成的。

<p class="notice-info">else​ 分支的逻辑是： 当编译器为 suspend lambda 生成的对象实现了 Function2​ 接口并非继承自 BaseContinuationImpl ​时，将其包装成 Continuation ​再返回。什么时候会走到 else 分支目前我并不清楚，因为目前为止我发现 suspend lambda 都是继承自 BaseContinuationImpl。​</p>


往前看 `startCoroutineCancellable()`​：

```kotlin
internal fun <R, T> (suspend (R) -> T).startCoroutineCancellable(
    receiver: R, completion: Continuation<T>,
    onCancellation: ((cause: Throwable) -> Unit)? = null
) =
    runSafely(completion) {
        createCoroutineUnintercepted(receiver, completion).intercepted().resumeCancellableWith(Result.success(Unit), onCancellation)
    }
```

​`intercepted()`​ 是 Kotlin 用来实现上下文切换的，这个我们先不管，因为我们的示例并未涉及协程的上下文切换，可以认为这个方法不包含任何逻辑，只是简单地返回对象本身。重点是 `resumeCancellableWith()`​ ：

```kotlin
public fun <T> Continuation<T>.resumeCancellableWith(
    result: Result<T>,
    onCancellation: ((cause: Throwable) -> Unit)? = null
): Unit = when (this) {
    is DispatchedContinuation -> resumeCancellableWith(result, onCancellation)
    else -> resumeWith(result)
}
```

涉及上下文切换时才会走到 `is DispatchedContinuation`​分支，因此程序会进入 `else`​ 分支，`else`​ 分支调用的是 `Continuation`​ 的 `resumeWith()`​，这个方法在 `Continuation`​ 接口定义：

```kotlin
public interface Continuation<in T> {
    /**
     * The context of the coroutine that corresponds to this continuation.
     */
    public val context: CoroutineContext

    /**
     * Resumes the execution of the corresponding coroutine passing a successful or failed [result] as the
     * return value of the last suspension point.
     */
    public fun resumeWith(result: Result<T>)
}
```

再进一步探索之前，我们先得了解一下协程中的 `Continuation` ​是什么东西。看下维基百科对协程的定义：

> **协程**（英语：coroutine）是计算机程序的一类组件，推广了[协作式多任务](https://zh.wikipedia.org/wiki/%E5%8D%8F%E4%BD%9C%E5%BC%8F%E5%A4%9A%E4%BB%BB%E5%8A%A1 "协作式多任务")的[子例程](https://zh.wikipedia.org/wiki/%E5%AD%90%E4%BE%8B%E7%A8%8B "子例程")，允许执行被挂起与被恢复

​`Continuation`​ 正是 Kotlin 用来实现协程 **允许执行被挂起与被恢复** 这一语义的。`Continuation`​ 逻辑上是一个栈式结构，它用来模拟 suspend 方法（包括 suspend lambda）的调用栈，为什么需要模拟 suspend 方法的调用栈？我们知道，非 suspend 方法的调用栈是由虚拟机维护的，也就是我们所熟悉的栈帧，但是虚拟机并不会为 suspend 方法生成栈帧，这是因为 suspend 方法的调用是异步的，虚拟机的世界中，并没有异步方法调用的概念，它属于 Kotlin 语言自己的语义范畴，Kotlin 编译器必须自己负责实现这个语义。

Kotlin 实现这个语义的方案是，编译时为每一个 suspend 方法生成一个与其相关联的 `Continuation`​ 对象（一般是 `BaseContinuationImpl` 的子类对象），由这个对象负责保存 suspend 方法的上下文，同时会为其生成一个 `invokeSuspend()` 方法，然后把 suspend 方法体的逻辑塞进这个 `invokeSuspend()` 方法中。编译器逻辑上会把一个 suspend 方法分割成多段分步执行，具体来说是：每当遇到对其他 suspend 方法的调用点时，当前 suspend 方法便会被挂起（暂停执行），其上下文会保存到关联的 `Continuation`​对象中，后续可调用其 `resumeWith()`​ 方法（通常由下游 suspend 方法关联的 `Continuation`​ 对象调用）恢复该 suspend 方法的上下文，让它从挂起点接着执行，就这样 “断断续续” 地执行直到当前 suspend 方法执行完毕。当前 suspend 方法执行完毕后，会调用调用栈上游的 suspend 方法关联的 `Continuation`​对象的 `resumeWith()`​方法，从而让上游的 suspend 方法接着执行。上游方法重复这个过程，直到最顶层的 suspend 方法执行完毕。

<p class="notice-success">现在听上去可能会有点抽象，接下来我们看具体实现就明白了。</p>

`resumeWith()` ​是 `Continiuation` ​接口的唯一方法，它在子类 `BaseContinuationImpl` ​中有个 `final` ​实现：

### BaseContinuationImpl

```kotlin
internal abstract class BaseContinuationImpl(
    // completion 便是上游 suspend 方法关联的 Continuation 对象
    public val completion: Continuation<Any?>?
) : Continuation<Any?>, CoroutineStackFrame, Serializable {

    public final override fun resumeWith(result: Result<Any?>) {
        var current = this
        var param = result
        while (true) {
            probeCoroutineResumed(current)
            with(current) {
                val completion = completion!! // fail fast when trying to resume continuation without completion
                val outcome: Result<Any?> =
                    try {
                        val outcome = invokeSuspend(param)
                        if (outcome === COROUTINE_SUSPENDED) return
                        Result.success(outcome)
                    } catch (exception: Throwable) {
                        Result.failure(exception)
                    }
                releaseIntercepted() // this state machine instance is terminating
                if (completion is BaseContinuationImpl) {
                    // unrolling recursion via loop
                    current = completion
                    param = outcome
                } else {
                    // top-level completion reached -- invoke and return
                    completion.resumeWith(outcome)
                    return
                }
            }
        }
    }

    // 此方法的实现由编译器生成
    protected abstract fun invokeSuspend(result: Result<Any?>): Any?

    ......
}
```

这是一个典型的用循环展开尾递归的的例子，目的是避免因过深的调用栈造成栈溢出，同时生成更简洁的调用栈信息。为了便于理解，将其还原成递归：

```kotlin
public final override fun resumeWith(result: Result<Any?>) {
    probeCoroutineResumed(this)
    val completion = completion ?: error("Completion should not be null")

    val outcome: Result<Any?> = try {
        val outcome = invokeSuspend(result)
        if (outcome === COROUTINE_SUSPENDED) return
        Result.success(outcome)
    } catch (e: Throwable) {
        Result.failure(e)
    }

    releaseIntercepted()

    if (completion is BaseContinuationImpl) {
        // 递归调用上游 Continuation
        completion.resumeWith(outcome)
    } else {
        // 调用到最顶层 Continuation
        completion.resumeWith(outcome)
    }
}
```

前面提到过，第 6 行的 `invokeSuspend()` 是编译器为 suspend lambda（或 suspend 方法）生成的 Continuaion 对象中的方法，其中包含了 suspend lambda（或 suspend 方法）方法体的逻辑。如果 `invokeSuspend()` 返回的是 `COROUTINE_SUSPENDED`​，则会导致`resumeWith()`​ 返回，这表示该`Continuation`​关联的 suspend 方法挂起。否则说明 suspend 方法执行完毕，接着会递归调用上游 suspend 方法的 `Continuation`​ 对象的 `resumeWith`​ 方法来恢复上游 suspend 方法的执行。

<p class="notice-info">Kotlin 将上游 suspend 方法的 Continuation​ 对象命名为 completion​ ，可以说是非常贴切了。</p>

我们回顾一下 `_SuspendLambda` 的 `invokeSuspend()` 方法，为便于理解我将其写成 Kotlin 并进行简化：

### _SuspendLambda

```kotlin
class _SuspendLambda : SuspendLambda, Function1<Object> {

	val label = 0

    public final fun invokeSuspend(result: Object): Object {
		var fun1Result: Object?
        when (this.label) {
            0 -> {
                Result.throwOnFailure(result)
                this.label = 1
                fun1Result = fun1(this as Continuation)         // fun1()
                if (fun1Result == COROUTINE_SUSPENDED) {
                    return COROUTINE_SUSPENDED
                }
            }

            1 -> {
                Result.throwOnFailure(result)
                fun1Result = result
            }

            else ->
                throw IllegalStateException("call to 'resume' before 'invoke' with coroutine")
        }

        val finalResult = fun1Result as Int
        println(finalResult)
        return Unit.INSTANCE
    }

    fun _SuspendLambda(Continuation completion) {
		super(0 /* 这个值具体是多少不知道，也不重要，我这里是乱写的 */, completion):
	}
    /** Invokes the function with the specified arguments. */
    final fun invoke(value: CoroutineScope, completion: Continuation): Object {
		return this.create(value, completion).invokeSuspend(completion)
	}

   fun invoke(Object p1, Object p2): Object {
        return this.invoke((CoroutineScope)p1, (Continuation)p2)
    }
		
    final fun create(value: CoroutineScope, completion: Continuation): Continuation {
         return _SuspendLambda(completion)
    } 
}
```

`invokeSuspend()` 中的代码就是 `Continuation`​ 将 suspend 方法 “分割成多段” 的直观展现。在我们的例子中，Kotlin 编译器将 suspend lambda 分割成了两段，一段是调用 `fun1()`​ 获取结果，另一段是打印结果。接下来我们就来分析一下，Kotlin 是如何对 suspned lambda 分段执行的。

第一次调用`_SuspendLambda`​的 `resumeWith()`​ 方法时，`label`​ 为 `0`​，会走到 `0 -> `​这个分支。这个分支的逻辑如下：

- 将 `label`​ 置位 1，这样下次就会从 `1 ->`​这个分支执行。
- 调用 `fun1()`​ 获取结果，因为`fun1() `​返回的是 `COROUTINE_SUSPENDED`​ （因为 `fun1()`​ 是 suspend 方法，所以此处返回的就是 `COROUTINE_SUSPENDED`​，原因后面分析 `fun1()`​ 的时候就知道了）， 所以`invokeSuspend()`​ 会从第 13 行返回，`resumeWith()`​拿到这个结果后，suspend lambda 的执行则会终止。

你可能会有疑问，示例代码中的`fun1()`​ 没有参数，为什么这里会传参数？前面说过，当一个 suspend 方法执行完毕后，它会调用上游 suspend 方法关联的 `Continuation`​ 对象的 `resumeWith()`​ 方法来恢复上游方法的执行，因此下游方法必须拿到上游方法的 `Continuation`​ 对象才行。和 suspend lambda 一样，Kotlin 编译器也会为每一个 suspend 方法自动添加一个 `Continuation`​ 类型的参数，目的就是为了让下游方法持有上游方法的 `Continuation`​ 对象。

<p class="notice-success">实际上这个参数有多重含义，这个后面会说</p>

现在来看看 `fun1()`​ 的逻辑，其反编译结果如下：

```kotlin
   @Nullable
   public static final Object fun1(@NotNull Continuation var0) {
      Object $continuation;
      label27: {
         if (var0 instanceof <undefinedtype>) {
            $continuation = (<undefinedtype>)var0;
            if ((((<undefinedtype>)$continuation).label & Integer.MIN_VALUE) != 0) {
               ((<undefinedtype>)$continuation).label -= Integer.MIN_VALUE;
               break label27;
            }
         }

         $continuation = new ContinuationImpl(var0) {
            int I$0;
            // $FF: synthetic field
            Object result;
            int label;

            @Nullable
            public final Object invokeSuspend(@NotNull Object $result) {
               this.result = $result;
               this.label |= Integer.MIN_VALUE;
               return TestKt.fun1((Continuation)this);
            }
         };
      }

      Object var10000;
      int localInt;
      int var2;
      Object var3;
      label22: {
         Object $result = ((<undefinedtype>)$continuation).result;
         Object var6 = IntrinsicsKt.getCOROUTINE_SUSPENDED();
         switch (((<undefinedtype>)$continuation).label) {
            case 0:
               ResultKt.throwOnFailure($result);
               localInt = 0;
               var2 = localInt;
               ((<undefinedtype>)$continuation).I$0 = localInt;
               ((<undefinedtype>)$continuation).label = 1;
               var10000 = fun2((Continuation)$continuation);
               if (var10000 == var6) {
                  return var6;
               }
               break;
            case 1:
               var2 = ((<undefinedtype>)$continuation).I$0;
               ResultKt.throwOnFailure($result);
               var10000 = $result;
               break;
            case 2:
               var2 = ((<undefinedtype>)$continuation).I$0;
               ResultKt.throwOnFailure($result);
               var10000 = $result;
               break label22;
            default:
               throw new IllegalStateException("call to 'resume' before 'invoke' with coroutine");
         }

         var3 = var10000;
         localInt = var2 + ((Number)var3).intValue();
         var2 = localInt;
         ((<undefinedtype>)$continuation).I$0 = localInt;
         ((<undefinedtype>)$continuation).label = 2;
         var10000 = fun3((Continuation)$continuation);
         if (var10000 == var6) {
            return var6;
         }
      }

      var3 = var10000;
      localInt = var2 + ((Number)var3).intValue();
      return Boxing.boxInt(localInt);
   }
```

为了便于理解同样改写成 Kotlin 代码。代码太多，我使用了 ChatGPT 来辅助完成：

### fun1

```kotlin
private class Fun1Continuation(
    val completion: Continuation<Any?>
) : ContinuationImpl<Any?>(completion) {
    var label = 0
    var result: Any? = null
    var I$0: Int = 0

    override fun invokeSuspend(result: Result<Any?>) {
        this.result = result.getOrNull()
        this.label = this.label or 0x80000000
        return fun1(this)
    }
}

fun fun1(continuation: Continuation<Any?>): Any? {
    // 如果 continuation 是之前包装过的，直接使用；否则将 continuation 包装成一个 Fun1Continuation，将其作为上游 Continuation 持有
    val cont = if (continuation is Fun1Continuation) {
        if ((continuation.label and 0x80000000) != 0) {
            continuation.label = continuation.label and 0x7fffffff
            continuation
        } else {
            Fun1Continuation(continuation)
        }
    } else {
        Fun1Continuation(continuation)
    }

    var result = cont.result

    run handleAfterFun3@{
        run handleAfterFun2@{
            when (cont.label) {
                0 -> {
                    // 初始状态
                    Result.throwOnFailure(result)
                    val localInt = 0
                    cont.I$0 = localInt
                    cont.label = 1
                    val res = fun2(cont)
                    if (res === COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED
                    result = res
                }

                1 -> {
                    // 如果 fun2 是异步，那么从 fun2 恢复时会进入到这个分支
                    Result.throwOnFailure(result)
                    return@handleAfterFun2 
                }

                2 -> {
                    // 如果 fun3 是异步，那么从 fun3 恢复时会进入到这个分支
                    Result.throwOnFailure(result)
                    return@handleAfterFun3
                }

                else -> throw IllegalStateException("call to 'resume' before 'invoke' with coroutine")
            }

        }
        // fun2 执行完毕后的逻辑，无论同步异步都会走到这
        val localInt = cont.I$0
        cont.I$0 = localInt + result
        cont.label = 2
        val res = fun3(cont)
        if (res === COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED
        result = res
    }
    // fun3 执行完毕后的逻辑，无论同步异步都会走到这
    val localInt = cont.I$0
    val finalResult = localInt + result
    return finalResult
}
```

改写后的代码逻辑清晰多了，我们来分析一下 `fun1()` 中的逻辑：

- 首先是为 `fun1()`​ 构造与之关联的 `Continuation`​。如果传入的 `Continuation`​ 是 `Fun1Continuation`​ 类型，说明已经包装过了，就不做处理，否则，使用 `Fun1Continuation`​ 对 `continuation`​ 进行包装，将其作为上游 `Continuation`​ 持有。最后得到的 `cont`​ 便是 `fun1()`​ 所关联的 `Continuation`​。前面说过了，`Continuation`​ 中包含了函数的上下文，从 `Fun1Continuation` 的定义能看出，这个上下文包含以下几个部分：

  - 执行进度，即 `cont.label`​；
  - 上游 `suspend`​ 方法的 `Continuation`​ 对象，即 `Fun1Continuation` 构造方法传入的 `completion`​
  - 局部变量，即 `cont.I$0`​，对应示例中的 `localInt`​；
  - 上一次调用 suspend 方法的结果，即 `cont.result`​；

接着往下看，有三个分支。

首先是  `0->`​ 分支，`fun1()`​ 首次调用时会进入这个分支。这个分支做了以下几件事：

- 将 `label`​ 置为 1，将 `fun1()`​ 执行进度往下推进，下次调用时就会从 `1->`​ 这个分支执行。
- 调用 `fun2()`​ 获取其结果，如果结果为 `COROUTINE_SUSPENDED`​ ，说明 `fun2()`​ 挂起，`fun1()`​ 也返回`COROUTINE_SUSPENDED，`​表示自己因为 `fun2()`​ 的挂起而挂起。然而实际上`fun2()`​ 是一个披着 suspend 外衣的普通方法，Kotlin 并不会将它当做 suspend 方法看待，这个方法编译后是一个普通的同步方法，所以此处 `fun2()`​ 返回的是 1，`fun1()`​ 会跳转到 61 行继续执行。
- 将 `fun2()`​ 返回值累加到 `localInt`​ 上；
- 将 `label`​ 置为 `2`​，将 `fun1()`​ 执行往下推进。下次执行时就会从 `2->`​ 这个分支执行。由此可见，`1->`​ 分支实际上并不会被执行，这是 `fun2()`​ 为同步方法造成的；
- 调用 `fun3()`​ ，`fun3()`​ 是一个 suspend 方法，它会返回 `COROUTINE_SUSPENDED`​，故`fun1()`​ 会从第  65 行返回，`fun1()`​ 的执行告一段落。

​`fun1()`​ 此次调用结束后返回 suspend lambda 的第 11 行处：`fun1Result = fun1(this as Continuation)`​，前面我们说 `fun1()`​ 返回的是 `COROUTINE_SUSPENDED`​，这个结论在此处得到了印证。

接下来我们分析 `fun3()`​，`fun3()`​ 的反编译代码我就不放了，我们直接看用 Kotlin 改写后的简化版：

### fun3

```kotlin
private class Fun3Continuation(
    val completion: Continuation<Any?>
) : ContinuationImpl<Any?>(completion) {
    var label = 0
    var result: Any? = null

    override val context = completion.context

    override fun invokeSuspend(result: Result<Any?>) {
		this.result = result.getOrNull()
		this.label = this.label or 0x80000000
		return fun3(this)
    }
}

fun fun3(continuation: Continuation<Any?>): Any? {
    val cont = if (continuation is Fun3Continuation) {
        if ((continuation.label and 0x80000000) != 0) {
            continuation.label = continuation.label and 0x7fffffff
            continuation
        } else {
            Fun3Continuation(continuation)
        }
    } else {
        Fun3Continuation(continuation)
    }

    var result = cont.result

	when (cont.label) {
        0 -> {
            Result.throwOnFailure(result)
            cont.label = 1
            val res = delay(1000L, cont)
            if (res === COROUTINE_SUSPENDED) return COROUTINE_SUSPENDED
        }

        1 -> {
            Result.throwOnFailure(result)
        }

        else -> throw IllegalStateException("call to 'resume' before 'invoke' with coroutine")
     }

     return 1
}
```

逻辑和 `fun1()`​ 是大同小异的，前面的就不赘述了，进入到 `0-> `​分支后，调用了 `delay()`​ 方法，这是 Kotlin 提供的延时函数，它也是一个 suspend 方法，因此它会返回 `COROUTINE_SUSPENDED`​给 `fun1()`​，这和前面的分析是一致的。

继续深入下去会发现，`delay()`​ 会将一个延时任务插入到事件循环中，`1000ms`​ 延时后延时任务会调用 `Fun3Continuation`​ 的 `resumeWith()`​ 方法，这个方法会调到第 9 行的 `invokeSuspend()`​ 方法，`fun3()`​ 会再次执行。再次执行时，`cont.label `​的值为 `1`​，进入 `1->`​ 分支，检查无异常后代码走到 45 行返回 `1`​，`fun3()`​ 执行完毕。

​`fun3`​ 执行完成后，`Fun3Continuation`​会用 `fun3`​ 的执行结果 `1`​ 作为参数调用其 `completion`​ 也就是 `Fun1Continuation`​ 的 `resumeWith()`​ 方法，这个方法会调到第 8 行的 `invokeSuspend()`​ 方法，这会导致 `fun1()`​ 再次执行，再次执行时 `cont.label`​ 的值为 `2`​，会走到 `2->`​ 分支，检查无异常后代码走到第 69 行，将 `fun3()`​ 的执行结果 `1`​ 累加到 `localInt`​ 后将其作为最终结果返回，`fun1()`​ 执行完毕。

​`fun1()`​ 执行完成后，`Fun1Continuation`​会用 `fun1`​ 的执行结果 `localInt`​ 作为参数调用其 `completion`​也就是 `_SuspendLambda`​ 的 `resumeWith()`​ 方法，这个方法会调到第 5 行的 `invokeSuspend()`​ 方法，会导致 suspend lambda 再次执行，再次执行时  `label`​ 值为 `1`​， 会走到 `1 ->`​分支处，检查无异常后代码走到第 26 行，将 `fun1()`​ 的执行结果 `localInt`​ 打印出来，suspend lambda 执行完毕。

## BlockingCoroutine

前面说过，当一个 suspend 方法结束后，它的上游 suspend 方法的 `Continuation`​ 的 `resumeWith()`​ 会被调用。那么问题来了，当顶层的 suspend lambda 结束后呢？答案是 `BlockingCoroutine`​ 的 `resumeWith()`​ 会被调用。虽然 suspend lambda 没有上游 suspend 方法，但是它有上游  `Continuation`​，`BlockingCoroutine`​ 就是这个上游 `Continuation`​，它是 `_SuspendLambda#create()` ​调用时传进去的。`BlockingCoroutine`​ 定义如下：

```kotlin
private class BlockingCoroutine<T>(
    parentContext: CoroutineContext,
    private val blockedThread: Thread,
    private val eventLoop: EventLoop?
) : AbstractCoroutine<T>(parentContext, true, true) { 
    ...... 
}
```

它继承自 `AbstractCoroutine`​：

### AbstractCoroutine

```kotlin
public abstract class AbstractCoroutine<in T>(
    parentContext: CoroutineContext,
    initParentJob: Boolean,
    active: Boolean
) : JobSupport(active), Job, Continuation<T>, CoroutineScope {

   ……

    protected open fun onCompleted(value: T) {}

    protected open fun onCancelled(cause: Throwable, handled: Boolean) {}

   ……

    /**
     * Completes execution of this with coroutine with the specified result.
     */
    public final override fun resumeWith(result: Result<T>) {
        val state = makeCompletingOnce(result.toState())
        if (state === COMPLETING_WAITING_CHILDREN) return
        afterResume(state)
    }

    protected open fun afterResume(state: Any?): Unit = afterCompletion(state)

    ……
}
```

​`AbstractCoroutine#resumeWith`​最终会调到`JobSupport#afterCompletion()`​，它在 `BlockingCoroutine`​有实现：

```kotlin
private class BlockingCoroutine<T>(
    parentContext: CoroutineContext,
    private val blockedThread: Thread,
    private val eventLoop: EventLoop?
) : AbstractCoroutine<T>(parentContext, true, true) {

    override val isScopedCoroutine: Boolean get() = true

    override fun afterCompletion(state: Any?) {
        // wake up blocked thread
        if (Thread.currentThread() != blockedThread)
            unpark(blockedThread)
    }

    @Suppress("UNCHECKED_CAST")
    fun joinBlocking(): T {
        registerTimeLoopThread()
        try {
            eventLoop?.incrementUseCount()
            try {
                while (true) {
                    @Suppress("DEPRECATION")
                    if (Thread.interrupted()) throw InterruptedException().also { cancelCoroutine(it) }
                    val parkNanos = eventLoop?.processNextEvent() ?: Long.MAX_VALUE
                    // note: process next even may loose unpark flag, so check if completed before parking
                    if (isCompleted) break
                    parkNanos(this, parkNanos)
                }
            } finally { // paranoia
                eventLoop?.decrementUseCount()
            }
        } finally { // paranoia
            unregisterTimeLoopThread()
        }
        // now return result
        val state = this.state.unboxState()
        (state as? CompletedExceptionally)?.let { throw it.cause }
        return state as T
    }
}
```

​`afterCompletion` ​会将 `runBlocking()`​ 的调用者线程唤醒，这通常发生在 `runBlocking()`​调用线程和协程运行线程不相同的情况下，例如我们调用 `runBlocking()`​ 的时候，指定了 `Dispatcher`​:

```kotlin
runBlocking(Dispatchers.IO, {
	……
})
```

这会导致 24 行的 `eventLoop`​ 为 `null`​，从而让调用者线程走到 27 行进行无限时长的休眠，以达到阻塞调用者线程的目的。这种情况下就需要协程在 Dispatcher 线程中结束后，唤醒 `runBlocking()` 调用者线程，从而继续执行后面的代码。

否则，如果没有指定 `Dispatcher`​，`eventLoop` 便会充当 `Dispatcher`， `eventLoop` 不为 `null`，协程会运行在 `runBlocking()` 调用者线程驱动的 `eventLoop` 中。调用者线程自身会因为在 `while` 循环中持续运行 `eventLoop`​ 自行阻塞。等协程结束后，`eventLoop`​ 会在 26 行退出，因此协程结束的回调​`afterCompletion` 中用 `if` 语句做了一个判断：当协程运行在调用者线程中时，并不需要唤醒调用者线程。

# 总结

- 每一个 `suspend`​ 方法都和一个 `Continuation`​ 对象关联着；（`fun2()`​ 这种并没有真正 `suspend`​ 的方法除外）
- 当一个方法返回 `COROUTINE_SUSPENDED`​ 时，其实就是就是告诉调用者自己将会挂起（暂停），这个返回值会导致 suspend 调用栈中止，调用栈上游的所有方法也都被挂起；
- 下游 suspend 方法恢复时，会通过调用上游 suspend 方法所关联的 `Continuation`​ 对象的 `resumeWith()`​ 方法，触发上游方法的恢复。

最后画一张图帮助理解：

![Kotlin 协程](/img/in-post/post_kotlin_coroutine_state_machine/kotlin_coroutine.svg)

 Kotlin 协程中的所谓状态机，其实就是 Kotlin 为 `suspend`​ 方法生成的 `Continuation`​ 对象，`Continuation`​ 负责存储状态，suspned 方法恢复时从哪开始执行以及方法当前局部变量值由 `Continuation`​ 中的状态决定。

​`Contiuation`​ 在无栈协程中充当了栈帧（上下文）的作用：

- 保存了局部变量，即 `Continuation`​ 中的 `I$0`​ 字段；
- 保存了方法中断后的返回地址，即 `label`​；
- 每一个 `Continuation`​ 通过 `completion`​ 字段引用上游方法的 `Continuation`​，构成了一条`Continuation`​ 链，这就是 `suspend`​ 方法专属的 “调用栈”。