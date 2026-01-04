---

title: Gradle DSL 原理
date: 2023-04-13 21:14:51
layout:     post
subtitle:  ""
author:    "chance"
catalog:  true
tags:
    - Gradle

---

# 前言

gradle 的强大之处不在于它本身提供了多少功能，而是它的扩展性极强，开发者可以在构建脚本中定义任务，或者引入插件，将各式各样的任务集成到构建流程中。借助 gradle 灵活的 DSL ，开发者很容易完成构建脚本的编写。但也正是由于 DSL 太过于灵活，gradle 脚本的语法经常让我们琢磨不透，无法从传统编程语言的角度去理解它。这篇文章将会结合源码探究 gralde 的 dsl 实现原理，旨在帮助大家消除对于 Gradle 脚本语法的各种疑惑，更好地理解 Gradle。

# 走近 Groovy

我们知道，Gradle 是基于 Groovy 的，Groovy 是一门动态的 JVM 语言，Gradle 灵活的 DSL 就是建立在 Groovy 的动态性之上的。在探究 Gradle  之前，我们最好先对 Groovy 动态性的实现原理有一个初步的认知。

从一个简单的例子开始：

```java
class A {}
A a = new A()
a.b = new Object()
```

如果这是一段 Java 代码，肯定会报错，因为找不到属性 `b`。但是在 Groovy 中就不一样了，上面这段代码在大概会编译成这个样子（实际上比这复杂，这是简化后的代码）：

```groovy
// groovy 脚本中定义的所有类都会自动实现 GroovyObject 
class A implements GroovyObject {
}
A a = new A()
a.setProperty("b", new Object())
```
<!-- more -->
上面这段代码在 Groovy 中可以编译通过，但运行的话依然会报错。因为 `setProperty()` 默认会通过反射尝试访问 `A` 的 `b` 属性，但 `A` 并没有该属性。现在我们对 `A` 进行一些改造：

```java
class A implements GroovyObject {

    Map<String, Object> dynamicProperties = new HashMap<>()

    @Override
    void setProperty(String propertyName, Object newValue) {
        try {
            super.setProperty(propertyName, newValue)
        } catch (ignored) {
            dynamicProperties.put(propertyName, newValue)
        }
    }

    @Override
    Object getProperty(String propertyName) {
        try {
            return super.getProperty(propertyName)
        } catch (ignored) {
            return dynamicProperties.get(propertyName)
        }
    }
}
```

我们重写了 `setProperty` 和`getProperty` 方法，引入了 `dynamicProperties` 这个属性容器，这就是让 Groovy 具备动态性的魔法。经过改造后，对于 `b` 的访问不再通过反射来进行，而是转成了对属性容器的存取。利用这个语言特性，我们就可以实现偷梁换柱了。

# Groovy 对于脚本的支持

Groovy 不仅是一门动态语言，还是一门脚本语言。脚本语言的一个特点是，可以直接把逻辑写在最外层。比如：

```groovy
print("hello world")
```

Groovy 终究是要被变成 Class 文件在 JVM 上执行的，JVM 可做不到直接直接执行一个在顶层作用域中的方法，所有方法无论是实例方法还是静态方法，都必须属于一个类。不难猜到，groovyc 肯定会将上述代码封装成一个类，这个类就是 `Script `类。groovyc 会将所有的脚本编译成 `Script` 的子类。`Script` 有一个待实现方法 `run()`，脚本中的代码会被放入到 `Script` 子类的 `run()` 中。执行这个子类对象的 `run()` 方法，也就等于执行了脚本中的逻辑。

前面我们说过，Groovy 世界里的对象，都实现了 `GroovyObject` 类，`Script` 也不例外。但 `Script` 不是直接继承自 `GroovyObject`，而是 `GroovyObjectSupport`，这个类定义如下：

```groovy
public abstract class GroovyObjectSupport implements GroovyObject {
    private transient MetaClass metaClass = this.getDefaultMetaClass();

    @Transient
    public MetaClass getMetaClass() {
        return this.metaClass;
    }

    public void setMetaClass(MetaClass metaClass) {
        this.metaClass = (MetaClass)Optional.ofNullable(metaClass).orElseGet(this::getDefaultMetaClass);
    }

    private MetaClass getDefaultMetaClass() {
        return InvokerHelper.getMetaClass(this.getClass());
    }
}
```

揭晓一下 `GroovyObject` 的真面目：

```groovy
public interface GroovyObject {
    default Object invokeMethod(String name, Object args) {
        return this.getMetaClass().invokeMethod(this, name, args);
    }

    default Object getProperty(String propertyName) {
        return this.getMetaClass().getProperty(this, propertyName);
    }

    default void setProperty(String propertyName, Object newValue) {
        this.getMetaClass().setProperty(this, propertyName, newValue);
    }

    MetaClass getMetaClass();

    void setMetaClass(MetaClass var1);
}
```

`MetaClass` 代表当前类元数据，它知道当前类有哪些属性，有哪些方法，它的 `getProperty()` 和 `invokeMethod()` 会以反射的方式访问当前类的属性和方法。groovy 脚本可以直接使用 `print*()` 和 `evaluate()` 方法，其原因就是 `Script` 中定义这些方法，借助 `MetaClass `就可以访问它们。

<p class="notice-info">这也是为什么在接下来的 script.groovy 中，可以调用 MyScriptBaseClass 提供的 customPrintln 类的原因。</p>

Groovy 脚本的强大之处在于，开发者可以对脚本环境进行定制。

compile.groovy：

```groovy
import groovy.lang.GroovyClassLoader
import org.codehaus.groovy.control.CompilerConfiguration
import groovy.lang.Script

// 自定义脚本基类，让编译器为 script.groovy 生成的基类为这个类，而不是 Script
abstract class MyScriptBaseClass extends Script {
  // 为脚本提供提供全局方法
  def customPrintln(String msg) {
    System.out.println(msg)
  }
}
// 为脚本绑定全局属性
def binding = new Binding()
binding.setProperty("global", new Object() {
    def customPrintln(String msg) {
        System.out.println(msg)
      }
  })

def compilerConfiguration = new CompilerConfiguration()
// 执行字节码输出目录
compilerConfiguration.targetDirectory = new File("./")
// 自定义脚本基类
compilerConfiguration.scriptBaseClass = MyScriptBaseClass.class.name

def classLoader = new GroovyClassLoader(this.class.classLoader, compilerConfiguration)
def scriptClass = classLoader.parseClass(new File("./script.groovy"))
def script = scriptClass.newInstance()
// 绑定全局变量
script.setBinding(binding)
// 运行脚本
script.run()
```

script.groovy：

```groovy
println "hello world"
global.customPrintln "hello world from customPrint provided by binding"
customPrintln "hello world from customPrintln provided by script base class"
```

运行 compile.groovy :

```shell
➜ groovy compile.groovy
hello world
hello world from customPrint provided by binding
hello world from customPrintln provided by script base class
```

以上代码为脚本扩充了一个全局对象和一个全局方法，实现起来非常简单。

# Gradle 的魔法

Gradle DSL 其实就是利用的 Groovy 的对脚本地定制化开发来实现的。编译 settings.gradle 脚本的时候，Gradle 会让把编译为 `SettingsScript` 的子类，编译 build.gradle 的时候，Gradle 会把脚本编译为 *`ProjectScript`* 的子类。这两个类的继承关系为：

- `BuildScript` 的继承链是： `SettingsScript` ->`PluginsAwareScript` -> `DefaultScript` ->` BaiscScript` -> `Script`

- `ProjectScript` 的继承链为：`ProjectScript` ->`PluginsAwareScript`-> `DefaultScript` -> `BaiscScript` -> `Script`

继承链的每一个基类，都承担着相应的职责。

## DefaultScript

`DefaultScript` 类定义主要定义了一些工具方法，方便我们编写脚本：

| DefaultScript 类方法清单 |
| -------------------------- |
| `apply(Map options)`                         |
| `buildscript(Closure configureClosure)`                         |
| `file(Object path)`                         |
| `uri(Object path)`                         |
| `files(Object paths, Closure configureClosure)`                         |
| `fileTree(Object baseDir, Closure configureClosure)`                         |
| `zipTree(Object zipPath)`                         |
| `tarTree(Object tarPath)`                         |
| `copy(Action<? super CopySpec> action)`                         |
| `mkdir(Object path)`                         |
| `delete(Action<? super DeleteSpec> action)`                         |
| `javaexec(Action<? super JavaExecSpec> action)`                         |
| `exec(Closure closure)`                         |

## PluginsAwareSript

`PluginsAwareScript` 中定义了` plugins()` ，这就是我们可以在脚本中 `pluings {}` 块应用插件的原因。

## ProjectScript 

`ProjectScript` 的定义如下：

```java
public abstract class ProjectScript extends PluginsAwareScript {

    ......

    @Override
    public void apply(Closure closure) {
        getScriptTarget().apply(closure);
    }

    @Override
    @SuppressWarnings("unchecked")
    public void apply(Map options) {
        getScriptTarget().apply(options);
    }

    @Override
    public void buildscript(Closure configureClosure) {
        getScriptTarget().buildscript(configureClosure);
    }

    @Override
    public LoggingManager getLogging() {
        return getScriptTarget().getLogging();
    }

    @Override
    public Logger getLogger() {
        return getScriptTarget().getLogger();
    }


    @Override
    public ProjectInternal getScriptTarget() {
        return (ProjectInternal) super.getScriptTarget();
    }

}
```

这个类重写了 `PluginsAwareScript` 和 `DefaultScript` 中的一些方法，同时我们会发现，他的很多方法都转调到了 `getScriptTarget()` 返回的对象上，这个对象是什么？答案在 `BasicScript` 中。

## BasicScript

```java
public abstract class BasicScript extends org.gradle.groovy.scripts.Script implements org.gradle.api.Script, DynamicObjectAware, GradleScript {
    ......

    private Object target;
    private ScriptDynamicObject dynamicObject = new ScriptDynamicObject(this);

    @Override
    public void init(Object target, ServiceRegistry services) {
        ......
        setScriptTarget(target);
    }

    public Object getScriptTarget() {
        return target;
    }

    private void setScriptTarget(Object target) {
        this.target = target;
        this.dynamicObject.setTarget(target);
    }

    public PrintStream getOut() {
        return System.out;
    }

    @Override
    public Object getProperty(String property) {
        return dynamicObject.getProperty(property);
    }

    @Override
    public void setProperty(String property, Object newValue) {
        dynamicObject.setProperty(property, newValue);
    }

    public Map<String, ?> getProperties() {
        return dynamicObject.getProperties();
    }

    public boolean hasProperty(String property) {
        return dynamicObject.hasProperty(property);
    }

    @Override
    public Object invokeMethod(String name, Object args) {
        return dynamicObject.invokeMethod(name, (Object[]) args);
    }

    @Override
    public DynamicObject getAsDynamicObject() {
        return dynamicObject;
    }
}
```

`BasicScript` 中的所有的方法调用都将会委托给 `dynamicObject`，它是一个 `ScriptDynamicObject` 对象，`ScriptDynamicObject`  继承自 `DynamicObject`。这个类顾名思义，代表着一个动态对象。什么是动态对象？从功能方面讲，就是可以在运行时对方法调用和属性访问进行转发的对象。其定义如下：

## ScriptDynamicObject

```java
private static final class ScriptDynamicObject extends AbstractDynamicObject {

        private final Binding binding;
        private final DynamicObject scriptObject;
        private DynamicObject dynamicTarget;

        ScriptDynamicObject(BasicScript script) {
            this.binding = script.getBinding();
            scriptObject = new BeanDynamicObject(script).withNotImplementsMissing();
            dynamicTarget = scriptObject;
        }

        public void setTarget(Object target) {
            dynamicTarget = DynamicObjectUtil.asDynamicObject(target);
        }

        @Override
        public Map<String, ?> getProperties() {
            return dynamicTarget.getProperties();
        }

        @Override
        public boolean hasMethod(String name, Object... arguments) {
            return scriptObject.hasMethod(name, arguments) || dynamicTarget.hasMethod(name, arguments);
        }

        @Override
        public boolean hasProperty(String name) {
            return binding.hasVariable(name) || scriptObject.hasProperty(name) || dynamicTarget.hasProperty(name);
        }

        @Override
        public DynamicInvokeResult tryInvokeMethod(String name, Object... arguments) {
            DynamicInvokeResult result = scriptObject.tryInvokeMethod(name, arguments);
            if (result.isFound()) {
                return result;
            }
            return dynamicTarget.tryInvokeMethod(name, arguments);
        }

        @Override
        public DynamicInvokeResult tryGetProperty(String property) {
            if (binding.hasVariable(property)) {
                return DynamicInvokeResult.found(binding.getVariable(property));
            }
            DynamicInvokeResult result = scriptObject.tryGetProperty(property);
            if (result.isFound()) {
                return result;
            }
            return dynamicTarget.tryGetProperty(property);
        }

        @Override
        public DynamicInvokeResult trySetProperty(String property, Object newValue) {
            return dynamicTarget.trySetProperty(property, newValue);
        }
        ......
    }
```

`ScriptDynamicObject` 封装了三个重要的对象：`binding`，`scriptObject`，`dynamicTarget`。

- `binding` 前面已经讲过，这里不再赘述。

- `scriptObject` 是另一个 `DynamicObject`，这个类由 `DefaultScript` 包装而来，叫做 `BeanDynamicObject`，对这个对象的方法和属性的访问最终都会通过 `DefaultScript` 的 `MetaClass` 来完成。所以不难猜到，其实 `BeanDynamicObject` 这个对象负责将属性访问和方法通过反射的方式转发给其宿主，也就是 `DefaultScript` 类及其子类对象，如 `ProjectScript`。

- `dynamicTarget` 默认情况下就是 `scriptObject`，可通过 `setTarget()` 覆盖，这个对象同样是个 `DynamicObject`。

可见，`ScriptDynamicObject` 只是个包工头而已，它自己几乎没干啥，只是将所有的方法调用和属性访问都转包给 `binding`，`scriptObject`，`dynamicTarget` 这三个对象了。前两个对象是对 Groovy 脚本特性的继承，第三个对象则用来实现 Gradle DSL。

`dynamicTarget` 由 `BasicScrip#init()` 注入进来，我们可以在 `init()` 里进行断点，然后以调试模式运行 gradle 脚本中任何一个任务，就能通过调用栈追溯到这个对象来自于 `DefaultProject#getAsDynamicObject()`。我们知道，一个 build.gradle 脚本对应着一个 Project，我们在脚本中的所有配置都是对这个 Project 进行的，`DefaultProject` 就代表着这个 Project。

现在，我们可以把焦点放到 `DefaultProject` 上了。我们以 `getAsDynamicObject()` 为入口，对其一探究竟：

## DefaultProject 

```java
public abstract class DefaultProject extends AbstractPluginAware implements ProjectInternal, DynamicObjectAware {
    ......
    private final ExtensibleDynamicObject extensibleDynamicObject;
    ......
    public DefaultProject(...) {
        ......

        services = serviceRegistryFactory.createFor(this);
        taskContainer = services.get(TaskContainerInternal.class);

        extensibleDynamicObject = new ExtensibleDynamicObject(this, Project.class, services.get(InstantiatorFactory.class).decorateLenient(services));
        if (parent != null) {
            extensibleDynamicObject.setParent(parent.getInheritedScope());
        }
        extensibleDynamicObject.addObject(taskContainer.getTasksAsDynamicObject(), ExtensibleDynamicObject.Location.AfterConvention);
        ......
    }
    @Override
    public DynamicObject getAsDynamicObject() {
        return extensibleDynamicObject;
    }
    ......
}
```

略去无关代码后，我们一眼就能看出 `ExtensibleDynamicObject` 是主角。我们看看 `ExtensibleDynamicObject` 中的逻辑：

## ExtensibleDynamicObject 

```java
public class ExtensibleDynamicObject extends MixInClosurePropertiesAsMethodsDynamicObject implements org.gradle.api.internal.HasConvention {
    ......
    public ExtensibleDynamicObject(Object delegate, Class<?> publicType, InstanceGenerator instanceGenerator) {
        this(delegate, createDynamicObject(delegate, publicType), new DefaultConvention(instanceGenerator));
    }

    public ExtensibleDynamicObject(Object delegate, AbstractDynamicObject dynamicDelegate, InstanceGenerator instanceGenerator) {
        this(delegate, dynamicDelegate, new DefaultConvention(instanceGenerator));
    }

    public ExtensibleDynamicObject(Object delegate, AbstractDynamicObject dynamicDelegate, Convention convention) {
        this.dynamicDelegate = dynamicDelegate;
        this.convention = convention;
        this.extraPropertiesDynamicObject = new ExtraPropertiesDynamicObjectAdapter(delegate.getClass(), convention.getExtraProperties());

        updateDelegates();
    }

    private void updateDelegates() {
        DynamicObject[] delegates = new DynamicObject[6];
        delegates[0] = dynamicDelegate;
        delegates[1] = extraPropertiesDynamicObject;
        int idx = 2;
        if (beforeConvention != null) {
            delegates[idx++] = beforeConvention;
        }
        if (convention != null) {
            delegates[idx++] = convention.getExtensionsAsDynamicObject();
        }
        if (afterConvention != null) {
            delegates[idx++] = afterConvention;
        }
        boolean addedParent = false;
        if (parent != null) {
            addedParent = true;
            delegates[idx++] = parent;
        }
        DynamicObject[] objects = new DynamicObject[idx];
        System.arraycopy(delegates, 0, objects, 0, idx);
        setObjects(objects);

        if (addedParent) {
            idx--;
            objects = new DynamicObject[idx];
            System.arraycopy(delegates, 0, objects, 0, idx);
            setObjectsForUpdate(objects);
        }
    }

    public void addObject(DynamicObject object, Location location) {
        switch (location) {
            case BeforeConvention:
                beforeConvention = object;
                break;
            case AfterConvention:
                afterConvention = object;
        }
        updateDelegates();
    }
    ......
```

`ExtensibleDynamicObject` 也是个不干活的，它是一个 `DynamicObject` 容器，它把 `DefaultProject` 封装成 `BeanDyanmicObject`，把 `convention.getExtraProperties()` 封装成 `ExtraPropertiesDynamicObjectAdapter`，还通过 `convention.getExtensionsAsDynamicObject()` 获取了 `ExtensionsDynamicObject`。在 `DefaultProject` 的构造函数中我们看到，它还通过 `addObject()` 获取了 `taskContainer.getTasksAsDynamicObject()`。脚本中所有对 `ExtensibleDynamicObject` 的方法调用和属性访问，都会转包给这些对象。

## 对 Ext 配置块的支持

现在我们看看 `getExtraProperties()`：

```java
public interface ExtensionContainer {
    ......
    /**
     * The extra properties extension in this extension container.
     *
     * This extension is always present in the container, with the name “ext”.
     *
     * @return The extra properties extension in this extension container.
     */
    ExtraPropertiesExtension getExtraProperties();
}
```

很显然，`ExtraPropertiesExtension` 代表 gradle 中的 `ext` Extension，通常我们利用这个 Extension 设置一些属性。`ExtraPropertiesDynamicObjectAdapter` 对它进行了封装，然后将属性暴露给脚本，我们在脚本中对 `ext` 中属性的访问都将透过 `ExtraPropertiesDynamicObjectAdapter` 来进行，这就是我们为什么可以在脚本中直接使用 `ext` 块中定义的属性的原因。

## 对 Extension 配置块的支持

我们现在看看 `convention.getExtensionsAsDynamicObject()` 返回的 `ExtensionsDynamicObject`：

```java
private class ExtensionsDynamicObject extends AbstractDynamicObject {
        @Override
        public String getDisplayName() {
            return "extensions";
        }

        @Override
        public boolean hasProperty(String name) {
            if (extensionsStorage.hasExtension(name)) {
                return true;
            }
            ......
            return false;
        }

        @Override
        public Map<String, Object> getProperties() {
            Map<String, Object> properties = new HashMap<String, Object>();
            ......
            properties.putAll(extensionsStorage.getAsMap());
            return properties;
        }

        @Override
        public DynamicInvokeResult tryGetProperty(String name) {
            Object extension = extensionsStorage.findByName(name);
            if (extension != null) {
                return DynamicInvokeResult.found(extension);
            }
            ......
            return DynamicInvokeResult.notFound();
        }

        public Object propertyMissing(String name) {
            return getProperty(name);
        }

        @Override
        public DynamicInvokeResult trySetProperty(String name, Object value) {
            checkExtensionIsNotReassigned(name);
            if (plugins == null) {
                return DynamicInvokeResult.notFound();
            }
            ......
            return DynamicInvokeResult.notFound();
        }

        public void propertyMissing(String name, Object value) {
            setProperty(name, value);
        }

        @Override
        public DynamicInvokeResult tryInvokeMethod(String name, Object... args) {
            if (isConfigureExtensionMethod(name, args)) {
                return DynamicInvokeResult.found(configureExtension(name, args));
            }
            ......
            return DynamicInvokeResult.notFound();
        }

        public Object methodMissing(String name, Object args) {
            return invokeMethod(name, (Object[]) args);
        }

        @Override
        public boolean hasMethod(String name, Object... args) {
            if (isConfigureExtensionMethod(name, args)) {
                return true;
            }
            ......
            return false;
        }
        ......

        private Object configureExtension(String name, Object[] args) {
            Closure closure = (Closure) args[0];
            Action<Object> action = ConfigureUtil.configureUsing(closure);
            return extensionsStorage.configureExtension(name, action);
        }
}
```

可以看到：

- 当访问属性时，这个对象会寻找对应的 Extension，然后将 Extension 返回，所以我们可以在脚本中直接通过 Extension 名获取 Extension，比如 `java.sourceCompatibility`

- 当调用方法时，会使用 `configureExtension` 对 Extension 进行配置，这里会假设 `args` 只包含一个 Closure 类型的参数，`ExtensionsStorage#configureExtension()` 方法的逻辑是：先根据 `name` 找到对应的Extension，然后对 Extension 用前面的 Closure 类型的参数进行配置，这就是为什么我们可以使用 `java {}` 这种方式配置 java Extension 的原因。

当我们使用 `java {}` 语法配置 Java Extension 时，此语法结构会被 Groovy 编译成对 `DefaultScript`  对象 `invokeMethod()` 方法的调用。调用参数为 `name: "java", args: closure`。前面分析过，`DefaultScript` 最终会把调用转发给 `ScriptDynamicObject`，而 `ScriptDynamicObject` 又会把调用转发给 `ExtensibleDynamicObject`，`ExtensibleDynamicObject` 是一个 `DynamicObject` 容器，它会继续把调用转发给容器中的 `DynamicObject`，当调用转发到 `ExtensionsDynamicObject` 时，会根据 `name` 获取到 java Extension，然后对 java Extension 进行配置。Gradle 会把 Extension 对象作为 closure 的 delegate，这样一来，closure 内就可以访问到 Extension 中的属性和方法了。

# 结语

其他的 DSL 语法原理也差不多，核心就是 `DynamicObject` 提供的动态性，而 `DynamicObject` 的动态性最终来源于 `GroovyObject`。篇幅有限就不展开了，大家有兴趣可以自己翻阅源码。
