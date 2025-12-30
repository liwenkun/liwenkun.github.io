---
layout:     post
title:      探究 Kotlin 协程中的状态机
subtitle:  
date:       2024-04-08
author:     "Chance"
catalog:  true
tags:
    - Kotlin
    - 协程
---

# 前言

Kotlin 中的协程是无栈协程，网上很多文章都说无栈协程一般都是通过状态机实现的，于是我打算利用反编译工具并结合协程库源码，来探究一下 Kotlin 到底是如何通过状态机实现协程的。

# 一个简单的示例

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

以上代码通过 `runBlocking()`​ 开启协程，协程调用 `fun1()`​ ，然后打印结果。`fun1()`​ 是一个 `suspend`​ 方法，它定义了一个局部变量 `localInt`​，然后依次执行了 `fun2()`​ 和 `fun3()`​ 并将二者结果累加到 `localInt`​ 中，最后将 `localInt`​ 返回。`fun2()`​ 是一个有 suspend 标识的同步方法, `fun3()`​ 内调用了 `delay()`​，`delay()`​ 是协程库提供的 `suspend`​方法。 

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

一般来说代码会走到 if 分支。if 分支调用了 suspend lambda 的 `create()`​ 方法。这个方法是编译器为 suspend lambda 生成的。我们需要反编译代码来进一步探究。

<p class="notice-info">传统的反编译工具没法反编译 Kotlin 代码，要使用 IDEA 自带的工具：打开 Kotlin 字节码文件，然后点击 工具 -> Kotlin -> 反编译为  Java。</p>

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

​`runBlocking$default()`​ 是 `runBlocking()`​ 的反编译后的名字。它接收四个参数，后面两个参数暂时不用理会。第一个参数类型为 `CoroutineContext`​，传入的是 `null`​。第二个参数是一个 `Function2`​ 对象，`Function2`​ 是 Kotlin 库中的一个接口，定义如下：

```kotlin
public interface Function2<in P1, in P2, out R> : Function<R> {
    /** Invokes the function with the specified arguments. */
    public operator fun invoke(p1: P1, p2: P2): R
}
```

Kotlin 编译器用 `Function1`​，`Function2`​ ... `FuncitonX`​  接口来实现 lambda 表达式，Function 后面的数字表示 lambda 参数的数量。如果 lambda 有 receiver，receiver 会被视为其第一个参数，则 `invoke()`​ 的第一个参数为 receiver，后续参数为 lambda 的实际参数。例如，一个带有 receiver 的 lambda 表达式  `val a: Int.(Int, Int) -> Int = { x: Int, y: Int -> this + x + y }`​ 会用类似下面的代码来实现：

```java
Function3 a =  new Function3<Integer, Integer, Integer, Integer> {
    public final Integer invoke(Integer p1, Integer p2, Integer p3) {
		return p1 + p2 + p3;
	}
}
```

对于 suspend lambda，实现则略有不同，例如对于一个有 receiver 的 suspend lambda： `val a: suspend Int.() -> Unit = {}`​，实际上生成的对象通常长这样的：

```java
class A extends SuspendLambda implements Function2<Object, Object, Object> {

    public final Object invokeSuspend(Object result) {
		 /* lambda 函数体逻辑，省略 */
    }

    public _SuspendLambda(Continuation completion) {
		super(0 /* 这个值具体是多少不知道，也不重要，我这里是乱写的 */, completion):
	}

   public final Continuation create(Object value, Continuation $completion) {
      return (Continuation)(new <anonymous constructor>($completion));
   }
   // 类型具体化后的 invoke
   public final Object invoke(int receiver, Continuation completion) {
      // 为什么不直接调用 invokeSuspend，而是重新生成一个实例？
      return ((<undefinedtype>)this.create(receiver, completion)).invokeSuspend(Unit.INSTANCE);
   }
   // Function2 接口方法 invoke
   public Object invoke(Object receiver, Object completion) {
      return this.invoke(((Number)p1).intValue(), (Continuation)p2);
   }
};
Function2<Object, Object, Object> a = new A<>(null);
```

和普通 lambda 不一样的地方在于，kotlin 为 suspend lambda 生成的类除了实现了 `FunctionX 接口`，还继承了 `SuspendLambda`，其实现的 invoke() 方法多了一个额外的 `Cotinuation`​ 类型的参数。此外，编译器还实现了继承自 `SuspendLambda` 的抽象方法 `invokeSuspend()`​ 、`create()`​ ， 并生成了一个 `invoke()`​ 重载方法。`invokeSuspend()`​ 中包含的是 lambda 函数体的逻辑，`create()`​ 则是用来创建该类的一个新实例，`invoke()`​ 重载方法貌似有点多余，只是对参数类型具体化了一下而已。

<p class="notice-success">为什么 invoke() 方法不直接调用 invokeSuspend()，而是要多此一举重新生成一个实例再去调用？因为 suspend lambda 实际上被编译成了一个状态机，一个状态机实例维护的是一次 suspend lambda 执行期间的状态，虽然很多时候我们创建的 lambda 实例都是匿名的，用完即弃（比如我们给 runBlocking() 传入的 suspend lambda），但一个实例也可以多次调用（比如多次调用 a()），为了避免同一个实例多次调用导致状态机内部状态混乱，Kotlin 会在每次调用时生成一个全新的实例。a 虽然本身是一个 suspend lambda 实例，但它在这里的角色更像是一个 suspend lambda 的实例工厂。</p>

现在回过头来看 `runBlocking`​ 的 suspned lambda 参数反编译后的代码：

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

它就是编译器为我们生成的 `SuspendLambda` 匿名子类对象，后续我会用 `_SuspendLambda`​ 代指这个匿名子类。

<p class="notice-info">反编译器没能展示出这个匿名类和 SuspendLambda 的继承关系，通过在 runBlocking() 中添加断点可以得知 suspend lambda 最终确实被编译成了 SuspendLambda 的一个匿名子类。</p>

`_SuspendLambda` 的 `invoke()`​ 有两个参数，第一个参数类型为 `CoroutineScope`​，它是 suspend lambda 的 receiver。

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

​`this`​ 是 suspend lambda，前面说了，它是一个 `_SuspendLambda`​ 对象，`_SuspendLambda`​ 的继承链是：`_SuspendLambda`​ -> `SuspendLambda` -> `ContinuationImpl`​ -> `BaseContinuationImpl`​ -> `Continuation`​，因此代码会进到 `if`​ 分支，调用 `_SuspendLambda` 的 `create()`​ 方法返回该它的一个新实例。

<p class="notice-info">什么时候会走到 else 分支目前我并不清楚，因为目前为止我发现 suspend lambda 都是继承自 BaseContinuationImpl，这不是重点，我们先不管。​</p>


回到上层函数 `startCoroutineCancellable()`​：

```kotlin
internal fun <R, T> (suspend (R) -> T).startCoroutineCancellable(
    receiver: R, completion: Continuation<T>,
    onCancellation: ((cause: Throwable) -> Unit)? = null
) =
    runSafely(completion) {
        createCoroutineUnintercepted(receiver, completion).intercepted().resumeCancellableWith(Result.success(Unit), onCancellation)
    }
```

​`intercepted()`​ 用来将协程放到其所关联的调度器中运行，这个我们先不管，可以认为这个方法不包含任何逻辑，只是 `return this`。重点是 `resumeCancellableWith()`​ ：

```kotlin
public fun <T> Continuation<T>.resumeCancellableWith(
    result: Result<T>,
    onCancellation: ((cause: Throwable) -> Unit)? = null
): Unit = when (this) {
    is DispatchedContinuation -> resumeCancellableWith(result, onCancellation)
    else -> resumeWith(result)
}
```

两个分支逻辑总体差不多，只是前者包含了调度相关的逻辑。实际上代码会进入到 `is DispatchedContinuation ->` 分支，但简单起见，我们假装程序会进入 `else`​ 分支，因为调度不是我们的重点，我们重点是搞清楚协程中的状态机是怎么回事。`else`​ 分支调用的是 `Continuation`​ 的 `resumeWith()`​，这个方法在 `Continuation`​ 接口定义：

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

再进一步探索之前，我们先得了解一下协程中的 `Continuation` ​是什么东西，不然后面会越来越懵逼。先从维基百科对协程的定义入手：

> **协程**（英语：coroutine）是计算机程序的一类组件，推广了[协作式多任务](https://zh.wikipedia.org/wiki/%E5%8D%8F%E4%BD%9C%E5%BC%8F%E5%A4%9A%E4%BB%BB%E5%8A%A1 "协作式多任务")的[子例程](https://zh.wikipedia.org/wiki/%E5%AD%90%E4%BE%8B%E7%A8%8B "子例程")，允许执行被挂起与被恢复

协作式多任务对应于抢占式多任务，前者是任务主动让出 CPU，后者是 CPU 剥夺任务的执行权。但我感觉用协作式多任务来概括协程，还是不够触及本质，因为线程也可以通过锁来实现协作式的挂起和恢复，比如 `wait` 和 `notify`。我觉得本质区别还是在于，协程是用户态是实现的多任务，其挂起和恢复也是在用户态进行的，成本较低。换句话说就是，多个协程可以同时跑在一个线程里，协程的切换可以在线程不发生切换的前提下进行。本质上还是那套分时复用的思想，只不过不是复用 CPU，而是线程。有两种实现方案：

1. 模拟操作系统对线程的调度。为每个协程分配一个不同于当前线程栈的专属栈，协程如果想要让出 CPU，就转去执行一个用户态例程，这个例程会在用户态对协程栈指针和寄存器进行保存，同时选中一个被挂起的协程，将当前栈指针和寄存器恢复为该协程之前所保存的。通过在不同的栈之间来回切换，实现了协程的调度和并发。但并不是所有语言都能在运行时在多个栈之间切换的，所有就有了下一种方案。
2. 将包含挂起点的方法（或者叫做异步方法，Kotlin 用 `suspend` 标识，JS 用 `async` 标识）转换成一个状态机，方法的上下文作为状态保存在状态机中，方法的执行变成了状态机的运行，方法的调用栈变成了状态机链。以前是方法开始，栈帧建立，方法结束，栈帧销毁，栈顶此时是上一个方法的栈帧；现在成了方法开始，状态机建立，方法挂起，状态机在某个中间状态暂停，方法恢复，状态机从上一状态过渡到下一状态，方法结束，状态机进入终止状态并销毁，状态机链末尾此时是上一个方法的状态机。多个协程无非就是多个状态机链，只要轮换着运行不同链末尾的状态机就能实现协程的调度和并发了。

采用第一种方案的叫做有栈协程，采用第二种方案的叫做无栈协程。Kotlin 使用的是第二种方案，这应该和 Kotlin 没法直接访问 JVM 虚拟机栈有关。

<!-- <p class="notice-info">除了实现上的不同，两者在使用上也有差异。有栈协程底层是货真价实的栈，方法不感知自己到底是运行在协程上下文还是线程上下文，栈被切换了，栈上的所有方法自然就被挂起了，所以有栈协程不需要用关键字来标识方法到底会不会被挂起。无栈协程则不同，需要开发者用关键字标识异步方法，编译器或运行时好将这些方法转换成状态机。因此无栈协程中异步方法会向上传染：一个方法被标识为异步，调用它方法也需要标识为异步。那为什么不将所有方法都看做是异步的，这样不就无需显式标识了？理论上我觉得这样也行，但如果将所有方法都看做异步，都转换成状态机去运行，效率应该会很低。或许可以根据调用关系自动推断方法是否异步，但编译期的工作量应该会很大，而且对于 Kotlin 这种需要和 Java 互操作的语言可能不太好实现。有栈的一个好处就是，代码不需要专门为协程做适配，比如一个库底层使用了 IO 函数，如果该函数是在协程上下文中调用的，运行时可以使用非阻塞 IO 实现，如果是在线程上下文被调用，就用阻塞 IO 实现，这些差异化的处理对库作者而言是透明的，不需要准备两套代码；但如果这个库想用于无栈协程，开发者就不得不为协程准备一套代码。
</p> -->

​`Continuation`​ 正是 Kotlin 用于实现协程的状态机。编译器会为每一个 suspend 方法生成一个相关联的 `Continuation`​ 类，一般是 `BaseContinuationImpl` 的子类，这个子类实现了父类的 `invokeSuspend()` 方法，该方法包含了 suspend 方法体的逻辑，但并不是直接 copy。`invokeSuspend()` 会将 suspend 方法根据挂起点分割成多段，运行时它会被多次调用，每次调用时会从上一挂起点开始执行，执行到下一个挂起点结束，然后保存当前的上下文，记录当前挂起点，上下文和挂起点共同构成了状态机的状态。该方法通常不会被外部直接调用，而是由  ​`Continuation`​ 的 `resumeWith()` 方法调用。`resumeWith()` 可以认为是  ​`Continuation`​ 暴露给外部的，用来恢复其运行的 API。当前 ​`Continuation`​ 运行完后（意味着对应的 suspend 方法执行完毕），会调用上游 ​`Continuation`​ 的 `resumeWith()` 方法，上游 ​`Continuation`​ 重复这个过程，直至最顶层的 ​`Continuation`​ 运行完毕。最顶层的 ​`Continuation`​ 运行完毕，就意味着最顶层的 suspend 方法执行完毕，同时也意味着协程结束。

<p class="notice-success">现在听上去可能会有点抽象，可以先往下看，等回过头来理解</p>

我们接着研究 `resumeWith()` ​方法。`resumeWith()` 是 `Continiuation` ​接口的唯一方法，它在子类 `BaseContinuationImpl` ​中有个 `final` ​实现：

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

前面说过，`invokeSuspend()` 会被 `resumeWith()` 调用，上述代码展现了具体的调用逻辑：如果 `invokeSuspend()` 返回的是 `COROUTINE_SUSPENDED`​，说明当前状态机运行到了一个挂起点，`resumeWith()` 会直接 `return` ，这就是实现 suspend 方法挂起语义的地方；否则说明当前 suspend 方法执行完毕，此时 `invokeSuspend()` 返回的结果，就是 suspend 方法的返回值，`resumeWith()` 会拿这个值去调用上游 `Continuation`​ 对象的 `resumeWith()`​ 从而恢复上游 suspend 方法的执行。

<p class="notice-info">Kotlin 将上游 suspend 方法的 Continuation​ 对象命名为 completion​，可以说是非常贴切了。</p>

现在回过头看 `_SuspendLambda` 的 `invokeSuspend()` 方法，为便于理解我将其写成 Kotlin 并简化：

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

可以看到，`invokeSuspend()` 将 suspend lambda 分割成了两段（所谓分割，其实就是 `switch case`）：一段是调用 `fun1()`​，另一段是打印结果。接下来我们按时间顺序分析一下，Kotlin 协程是如何完成对 suspned lambda 的调用的。

第一次调用`_SuspendLambda`​的 `resumeWith()`​ 方法时，`label`​ 为 `0`​，会走到 `0 -> `​这个分支。这个分支的逻辑如下：

- 将 `label`​ 置位 1，这样下次就会从 `1 ->`​这个分支执行。
- 调用 `fun1()`​，`fun1()` ​返回的是 `COROUTINE_SUSPENDED`​，这是因为遇到了 `fun1()` 的挂起点，`fun1()` 的挂起也会引起 suspend lambda 的挂起，所以 `invokeSuspend()`​ 会从第 13 行返回 `COROUTINE_SUSPENDED`，`resumeWith()`​ 拿到这个结果后会 `return`，suspend lambda 挂起。

你可能会有疑问，示例代码中的`fun1()`​ 没有参数，为什么这里会传参数？前面说过，`Continuation` 是链式结构，下游 `Continuation`​ 执行完成后，需要调用上游 `Continuation` 的​ `resumeWith()`​ 方法来恢复上游方法的执行，因此下游 `Continuation` 必须持有上游 `Continuation`​ 的引用才行。因此，和 suspend lambda 一样，Kotlin 编译器也会为每一个 suspend 方法自动添加一个 `Continuation`​ 类型的参数，从而让下游 `Continuation` 持有上游的 `Continuation`​。

<p class="notice-success">后面我们会发现，实际上这个参数有多重含义。上游方法调用下游方法时，传给下游方法的这个参数代表上游方法的 Continuation，下游方法恢复上游方法时，传给上游方法的这个参数是上游方法自身的 Continuation</p>

现在来看 `fun1()`​，其反编译结果如下：

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
    // 如果 continuation 是之前包装过的，直接使用；否则将 continuation 包装成一个 Fun1Continuation，将其作为上游 Continuation 被 Fun1Continuation 持有
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

改写后的代码逻辑清晰多了，我们来分析一下 `fun1()` 的逻辑：

- 首先是为 `fun1()`​ 构造与之关联的 `Continuation`​。如果传入的 `Continuation`​ 是 `Fun1Continuation`​ 类型，说明已经包装过了，就不做处理，否则，使用 `Fun1Continuation`​ 对 `continuation`​ 进行包装，将其作为上游 `Continuation` 被 `Fun1Continuation` 持有。最后得到的 `cont`​ 便是 `fun1()`​ 所关联的 `Continuation`​。前面说过，`Continuation`​ 包含了函数的上下文，从 `Fun1Continuation` 的定义能看出，这个上下文包含以下几个部分：

  - 执行进度，即 `cont.label`​；​
  - 局部变量，即 `cont.I$0`​，对应示例中的 `localInt`​；
  - 上游 `suspend`​ 方法的 `Continuation`​ 对象，即 `Fun1Continuation` 构造方法传入的 `completion`
  - 上次挂起点返回的结果，即 `cont.result`​；

接着往下看，有三个分支。

首先是  `0->`​ 分支，`fun1()`​ 首次调用时会进入这个分支。该分支做了以下几件事：

- 将 `label`​ 置为 1，将 `fun1()`​ 执行进度往下推进，下次调用时就会从 `1->`​ 这个分支执行。
- 调用 `fun2()`​ 获取其结果，如果结果为 `COROUTINE_SUSPENDED`​ ，说明 `fun2()`​ 挂起，`fun1()`​ 也返回 `COROUTINE_SUSPENDED`，​表示自己因为 `fun2()`​ 的挂起而挂起。然而实际上`fun2()`​ 是一个披着 suspend 外衣的普通方法，Kotlin 并不会将它当做 suspend 方法看待，这个方法编译后是一个普通的同步方法，所以此处 `fun2()`​ 返回的是 1，`fun1()`​ 会跳转到 61 行继续执行。
- 将 `fun2()`​ 返回值累加到 `localInt`​ 上；
- 将 `label`​ 置为 `2`​，将 `fun1()`​ 执行往下推进。下次执行时就会从 `2->`​ 这个分支执行。由此可见，`1->`​ 分支实际上并不会被执行，这是 `fun2()`​ 为同步方法造成的；
- 调用 `fun3()`​ ，`fun3()`​ 是一个 suspend 方法，它会返回 `COROUTINE_SUSPENDED`​，故 `fun1()`​ 会从第  65 行返回，`fun1()`​ 的执行告一段落。

​`fun1()`​ 此次调用结束后返回 `_SuspendLambda` 的第 11 行处：`fun1Result = fun1(this as Continuation)`​，这和前面对上了。

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

逻辑和 `fun1()`​ 是大同小异的，前面的就不赘述了，进入到 `0-> `​分支后，调用了 `delay()`​ 方法，这是 Kotlin 提供的延时函数，它也是一个 suspend 方法，因此它会返回 `COROUTINE_SUSPENDED`​ 给 `fun1()`​，这和前面的分析是一致的。

继续深入下去会发现，`delay()`​ 会将一个延时任务插入到事件循环中，`1000ms`​ 过后延时任务会调用 `Fun3Continuation`​ 的 `resumeWith()`​ 方法，该方法会调到第 9 行的 `invokeSuspend()`​ 方法，`fun3()`​ 会再次执行。再次执行时，`cont.label `​ 为 `1`​，进入 `1->`​ 分支，检查无异常后代码走到 45 行返回 `1`​，`fun3()`​ 执行完毕。

​`fun3`​ 执行完成后，`Fun3Continuation`​会用 `fun3`​ 的返回结果 `1`​ 作为参数调用其 `completion`​ 也就是 `Fun1Continuation`​ 的 `resumeWith()`​ 方法，该方法会调到第 8 行的 `invokeSuspend()`​ 方法，导致 `fun1()`​ 再次执行，再次执行时 `cont.label`​ 为 `2`​，走到 `2->`​ 分支，检查无异常后代码走到第 69 行，将 `fun3()`​ 的返回结果 `1`​ 累加到 `localInt`​ 后将其作为最终结果返回，`fun1()`​ 执行完毕。

​`fun1()`​ 执行完成后，`Fun1Continuation`​会用 `fun1`​ 的返回结果 `localInt`​ 作为参数调用其 `completion`​也就是 `_SuspendLambda`​ 的 `resumeWith()`​ 方法，该方法会调到第 5 行的 `invokeSuspend()`​ 方法，导致 suspend lambda 再次执行，再次执行时  `label`​ 为 `1`​， 走到 `1 ->`​分支处，检查无异常后代码走到第 26 行，将 `fun1()`​ 的返回结果 `localInt`​ 打印出来，suspend lambda 执行完毕。

## BlockingCoroutine

我们知道，一个 suspend 方法结束后，其上游 `Continuation`​ 的 `resumeWith()`​ 会被调用。那么问题来了，当顶层的 suspend lambda 结束后呢？答案是 `BlockingCoroutine`​ 的 `resumeWith()`​ 会被调用。是的，协程本身也是一个 `Continuation`，它作为 suspend lambda 的上游  `Continuation`​​ 在 `_SuspendLambda#create()` ​时传进去。

`BlockingCoroutine`​ 继承自 `AbstractCoroutine`​，我们先看 `AbstractCoroutine`​ 的定义。

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

​`AbstractCoroutine#resumeWith` ​最终会调到 `JobSupport#afterCompletion()`​，它在 `BlockingCoroutine`​有实现：

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

​`afterCompletion()` ​会判断当初调用 `runBlocking()`​ 的线程 `blockedThread` 和当前线程是不是同一个，如果不是，则将 `blockedThread` 唤醒，这通常发生在调用 `runBlocking()`​ 的线程和协程调度器所在线程不相同的情况下，例如我们调用 `runBlocking()`​ 的时候，指定了 `Dispatcher`​:

```kotlin
runBlocking(Dispatchers.IO) {
	……
}
```

指定 Dispatcher 会导致 24 行的 `eventLoop`​ 为 `null`​，从而让 `blockedThread` 走到 27 行进行无限时长的休眠，以达到阻塞的目的。这种情况下就需要协程在 Dispatcher 线程中结束后，帮助唤醒 `blockedThread`，从而让 `blockedThread` 继续执行 `runBlocking()` 后面的代码。

如果没有指定 `Dispatcher`​，`eventLoop` 则不为 `null`，`eventLoop` 会充当 Dispatcher。`eventLoop` 只负责将事件入队，内部没有线程去处理事件，因此需要 `blockedThread` 在 while 循环中不停地从 `eventLoop` 中取事件运行，以此驱动协程的运行。等协程结束后，`blockedThread` 会从 26 行跳出循环，接着执行 `runBlocking()` 后面的代码。

# 总结

- 每一个 `suspend`​ 方法都和一个 `Continuation`​ 对象关联着；（`fun2()`​ 这种并没有真正 `suspend`​ 的方法除外）
- Kotlin 协程中的所谓状态机，其实就是 `suspend`​ 方法关联的 `Continuation`​ 对象，`Continuation`​ 的状态即 suspend 方法的上下文，方法从何处恢复，由 `Continuation`​ 的 `label` 字段决定。
- ​`Contiuation`​ 在无栈协程中充当了栈帧（上下文）：
  - 保存了局部变量，即 `Continuation`​ 中的 `I$0`​ 字段；
  - 保存了方法中断后的返回地址，即 `label`​；
  - 每一个 `Continuation`​ 通过 `completion`​ 字段引用上游方法的 `Continuation`​，构成了一条`Continuation`​ 链，这就是 suspend 方法的 “调用栈”。

最后画一张图帮助理解：

![Kotlin 协程](/img/in-post/post_kotlin_coroutine_state_machine/kotlin_coroutine.svg)
