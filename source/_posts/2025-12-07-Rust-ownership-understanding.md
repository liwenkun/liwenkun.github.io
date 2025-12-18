---
layout:     post
title:      对 Rust 所有权的理解
subtitle:  
date:       2025-12-07
author:     "Chance"
catalog:  true
tags:
    - Rust
---

## Rust 所有权规则简述

对于低级语言而言，对象的回收往往是一个难题。一个对象创建后，往往会在各个地方传递，由于对象的引用者们生命周期不尽相同，也就不知道何时、由谁来负责对象的回收。

Rust 所有权规则是如何解决这个问题的呢？它把对象分为可变对象和不可变对象，对象的引用者分为所有者和借用者。下面是我根据自己的理解做的总结：

- 一个对象有且只能有一个所有者，对象的回收由其所有者负责，对象的所有权可以转移。
- 借用分为可变借用和不可变借用：

  - 多个不可变借用可共存；
  - 可变借用不可和其他借用共存，无论借用是可变还是不可变；
  - 对象所有者不能在不可变借用前写对象，不能在可变借用前读写对象；
  - 可变对象可以有可变和不可变借用，不可变对象只能有不可变借用；
- 对象的所有权转移时，对象的可变性可以发生更改。

<p class="notice-info">不能共存指的是它们的作用域不能有交集。一个变量的作用域从声明的地方开始，到最后一次使用的位置结束，这一点和其他语言不同。</p>

<!-- more -->

我们知道，编译器是知道栈上每一个变量的生命周期的。对于栈上的每一个变量，如果它是对象的借用者，那么它会在生命周期结束后释放借用，如果是对象的所有者，编译器会在该变量生命周期结束时，调用编译器为对象自动生成的析构函数，析构函数的逻辑是：

1. 如果对象实现了 `Drop` trait，调用它的 `drop` 方法以释放其持有的资源，比如释放连接，关闭文件等。容器类对象除了要释放缓冲区，还要负责析构缓冲区中的每一个对象，rust 提供了一个方法辅助容器类对象回收内部的元素：`drop_in_replace()`，该方法会调用每个元素的析构函数。
2. 如果对象包含其他成员对象，按声明顺序执行这些对象的析构函数。
3. 否则啥也不做，让对象随着栈帧或者外层对象的回收而回收即可。

结合代码体会上述概念：

```rust
fn main() {
    let a = String::from("value");  // a 为这个 String 对象的所有者
    {
        let b = &a; // b 通过 & 操作符获取对象的借用
    } // b 生命周期结束，释放借用
} // a 生命周期结束，释放对象
```

Rust 中的赋值操作默认使用的是 move 语义，move 语义就是用来实现资源所有权的转移。除了赋值，传参、`return` 这些操作使用的也都是 move 语义，除非类型实现了 `Copy` trait，那就使用 copy 语义，copy 语义不会转移原变量的所有权，原变量依然持有原对象的所有权，新变量拥有的是拷贝后的对象的所有权，例如：

```rust
fn main() {
    let a = String::from("value");  // a 为这个 String 对象的所有者
    {
        let b = &a; // b 通过 & 操作符获取对象的借用
    } // b 生命周期结束，释放借用
    let c = a;  // a 所有权转移，不可再用
    
    let i = 12; // i 成为这个 i32 对象的所有者
    let j = i; // 对象不发生移动，而是拷贝，因为 i32 实现了 Copy trait
    i; // i 依然可用
} // c 生命周期结束，释放对象
```

我们看下在借用前后读写原对象的情形：

```rust
struct Person {
    age: i32,
    name: &'static str
}
fn main() {
    let mut p = Person {
        age: 25,
        name: "John"
    };
    let p1 = &p; // 不可变借用
    p.age; // 在不可变借用前读原对象 ✅
    // p.age = 12; // 在不可变借用前写原对象 ❌
    p1.age;

    p.age; // 在不可变借用后读原对象 ✅
    p.age = 12; // 在不可变借用后写原对象 ✅
} 

fn test2() {
    let mut p = Person {
        age: 25,
        name: "John"
    };
    let p1 = &mut p; // 可变借用
    // p.age; // 在可变借用前读原对象 ❌
    // p.age = 12; // 在可变借用前写原对象 ❌
    p1.age;

    p.age; // 在可变借用后读原对象 ✅
    p.age = 12; // 在可变借用后写原对象 ✅
} 
```

转移所有权时可改写对象可变性：

```rust
fn main() {
    let p = Person {
        age: 12,
        name: "John"
    };
    change_mutability(p); // 所有权转移，对象由不可变转为可变。
}

fn change_mutability(mut p: Person) {
    p.age = 13;
    let q = p; // 所有权转移，对象由可变转为不可变。
    // q.age = 12; // ❌
}
```

析构逻辑验证：

```rust
struct MyStruct {
    data: String,
    another: MyStruct2,
}
struct MyStruct2 {
    data: String,
}

impl Drop for MyStruct2 {
    // MyStruct 的析构函数会负责调用其成员对象的析构函数
    fn drop(&mut self) {
        println!("Dropping MyStruct2 with data: '{}'!", self.data);
        // 这里可以模拟释放资源，比如关闭文件等
    }
}

impl Drop for MyStruct {
    fn drop(&mut self) {
        println!("Dropping MyStruct with data: '{}'!", self.data);
        // 这里可以模拟释放资源，比如关闭文件等
    }
}

pub fn main() {
    let mut my_vec = vec![MyStruct {
        data: "Hello, World!".to_string(), another: MyStruct2 { data: "Hi, World!".to_string() }
    }];
    println!("End of main function.");
}
```
输出：
```shell
Dropping MyStruct with data: 'Hello, World!'!
Dropping MyStruct2 with data: 'Hi, World!'!
```

## 相关语义的实现

### copy 语义

按位复制对象，即浅拷贝。因其浅拷贝的特性，Rust 有一条规则：实现了 `Copy` trait 的对象，不允许再实现 `Drop` trait，且内部对象也必须实现 `Copy` trait，也就意味着内部对象也不允许实现 `Drop` trait，如此递归下去……

如何理解这条规则？我们反过来想，一个对象如果实现了 `Drop` trait，它一定有独立于对象之外的资源需要释放，而 `Copy` trait 属于浅拷贝，只会按位复制对象本身，包括资源句柄（例如文件描述符，堆内存指针，socket 描述符等）。相同的资源句柄往往指向同一资源，因此 Copy 后两个对象共享外部资源。我们知道，编译器会在所有权变量作用域失效的位置插入 `drop`调用释放其持有的外部资源，如果 copy 后的两个所有权变量都执行了 `drop`，就会触发共享资源的双重释放。通常来说，资源重复释放是不允许的，比如堆内存就是这样，因此禁止实现了 `Copy` trait 同时实现 `Drop` trait 是一个很合理的做法。那是否存在这样一种情况：对象有需要释放的资源，它必须实现 `Drop` trait，但又想实现拷贝？有的，但这种情况往往隐含了一个前提，就是资源是非共享的，此时开发者应实现 `Clone` trait 而不是 `Copy` trait 来实现资源的拷贝，即深拷贝。

以下对象默认实现了 `Copy` trait：

- 基本标量类型
- 元组（当所有元素都实现 Copy 时）
- 数组（当元素类型实现 Copy 时）
- 不可变引用 (&T)
- 函数指针 (fn)
- 裸指针 (*const T, *mut T)
- Never 类型 (!)
- 单元类型 (())
- 标记类型（如 PhantomData）

一般来说，类型的使用者通常不需要关心其是否实现 `Copy` trait，否则写代码时的心智负担就太重了。

### move 语义

实际上是编译时检查 + 运行时浅拷贝实现的，原有对象其实还在内存中躺着，只是编译器不会让你继续使用所有权被转移的变量（除非对象实现了`Copy` trait）。

<p class="notice-success">感觉赋值时候的 move 语义完全可以只在语法层面实现，相当于是给变量重命名一下，让旧名字不再有效就行，不知道为什么 Rust 要在运行时进行浅拷贝，然后把旧值丢弃，感觉有点浪费了。</p>

可以用以下代码来验证：

```rust
fn main() {
    let s = String::from("value");
    // 将 &s 作为 raw pointer 使用，需要经历两次转换，先将引用转成 String 指针，再将指针类型转为 u64 指针;
    // Rust 中的借用本质就是一个指针，只不过编译器赋予了它 “借用” 的语义，从而将其纳入 Rust 的所有权模型中进行管理。
    let s_ref = &s as *const String as *const u64;
    println!(" ---------- 所有权转移前 ---------");
    println!("s 对象地址：{:p}", s_ref);
    println!("s 字符串缓冲区地址：{:p}", s.as_ptr());

    unsafe {
        println!("s 对象内容：{:#x}, {:#x}, {:#x}", *s_ref, *s_ref.add(1), *s_ref.add(2));
    }

    let s2 = s;
    let s2_ref = &s2 as *const String as *const u64;

    println!(" ---------- 所有权转移后 ---------");

    println!("s2 对象地址：{:p}", s2_ref);
    println!("s2 字符串缓冲区地址：{:p}", s2.as_ptr());

    unsafe {
        println!("s2 对象内容：{:#x}, {:#x}, {:#x}", *s2_ref, *s2_ref.add(1),*s2_ref.add(2));
        println!("s 对象 “尸体”：{:#x}, {:#x}, {:#x}", *s_ref, *s_ref.add(1), *s_ref.add(2));
    }
}
```

运行结果：

```shell
 ---------- 所有权转移前 ---------
s 对象地址：0x7fffd3847200
s 字符串缓冲区地址：0x572640b66d00
s 对象内容：0x5, 0x572640b66d00, 0x5
 ---------- 所有权转移后 ---------
s2 对象地址：0x7fffd38473a0
s2 字符串缓冲区地址：0x572640b66d00
s2 对象内容：0x5, 0x572640b66d00, 0x5
s 对象 “尸体”：0x5, 0x572640b66d00, 0x5
```

可见，move 语义只是将 String 对象在栈上浅拷贝一份，原有对象原封不动在栈上躺着。

<p class="notice-success">从打印结果可以看出，String 对象在栈上内存布局从低到高依次是：capacity （u64)，ptr（u64），len（u64），这和官方示意图不一样，不知为何 🤨。</p>

但并不是所有情况下，move 语义都会用运行时的浅拷贝来实现。实测发现，在传参的时候，如果对象的大小大于 8 字节，不会触发浅拷贝，move 语义仅停留在语法层面，测试代码如下：

```rust
struct M(u16, u16, u16, u8, u16);  // 9 字节
// struct M(u16, u16, u16, u8, u8);  // 8 字节

// 更好的方式：只实现 Clone，或者提供引用接口
fn main() {
    let a = M(1, 1, 1, 1, 1);
    let a_ref = &a as *const M;
    println!("原始地址：{:p}", a_ref);
    let b = a;
    let b_ref = &b as *const M;
    println!("赋值后地址：{:p}", b_ref);

    let d = test(b);
    let d_ref = &d as *const M;
    println!("函数返回后地址：{:p}", d_ref);
}

fn test(c: M) -> M{
    let c_ref = &c as *const M;
    println!("函数参数地址：{:p}", c_ref);
    return c;
}
```

输出：

```bash
# M 大于 8 字节时，传参时 move 前后对象地址一致
原始地址：0x7ffe50f05f26
赋值后地址：0x7ffe50f05f8e
函数参数地址：0x7ffe50f05f8e
函数返回后地址：0x7ffe50f05ff6

# M 小于等于 8 字节时，三种场景下 move 前后对象地址都不同
原始地址：0x7fff7ddb8188
赋值后地址：0x7fff7ddb81e8
函数参数地址：0x7fff7ddb8108
函数返回后地址：0x7fff7ddb8248
```

<p class="notice-info">以上分析是基于原对象在栈上分配的情形，如果原对象是堆上分配的，原理应该也差不多。</p>

参考链接🔗：[https://doc.rust-lang.org/reference/destructors.html](https://doc.rust-lang.org/reference/destructors.html)
