---
layout:     post
title:      理解跨源资源共享（CORS）
subtitle:  
date:       2024-04-04
author:     "Chance"
catalog:  true
tags:
    - 前端
---

## 什么是跨源请求

先看同源 URL 定义：

> 如果两个 URL 的[协议](https://developer.mozilla.org/zh-CN/docs/Glossary/Protocol)、[端口](https://developer.mozilla.org/zh-CN/docs/Glossary/Port)（如果有指定的话）和[主机](https://developer.mozilla.org/zh-CN/docs/Glossary/Host)都相同的话，则这两个 URL 是同源的。这个方案也被称为“协议/主机/端口元组”，或者直接是“元组”。（“元组”是指一组项目构成的整体，具有双重/三重/四重/五重等通用形式。）

当网页发出请求的 URL 和网页的 URL 是非同源的，我们便说这个请求是跨源请求。安全起见，浏览器会对跨源请求做出限制。


## 为什么要对跨源请求进行限制

假如你曾经登录过银行网站 A，该网站会将 token 保存在你浏览器的 Cookies 中。某天你收到了一封来自钓鱼网站 B 的邮件，你点开链接打开了 B 网站，B 网站调用 A 网站的转账接口，企图将你在这家银行的钱转进他的帐户里。如果浏览器不对跨源请求做任何限制，A 网站的 Cookies 便会附带到转账请求中，请求就能顺利通过 A 网站服务器的身份验证，你的钱就被转走了。

为了解决这个问题，浏览器引入了 **同源策略**。

<!-- more -->

## 什么是同源策略

同源策略(Same-Origin Policy)是浏览器的一个重要安全机制，用于限制不同源之间的资源访问，同源策略包含以下内容：

1. 不允许网页发送非同源的 Ajax 请求，否则浏览器拒绝发送请求，直接返回失败。
2. 允许 `img`、`script` 、`link` 这类资源标签触发的跨源请求，且请求会附带 Cookies，但对响应数据的访问加以限制。举个例子，如果开发者将跨源 `img` 绘制到 `canvas` 上，浏览器会将这张 `canvas` 标记为 “已污染”，后续开发者无法将 `canvas` 转储为图片文件（[`toBlob()`](https://developer.mozilla.org/zh-CN/docs/Web/API/HTMLCanvasElement/toBlob)）或者 data url （[`toDataUrl()`](https://developer.mozilla.org/zh-CN/docs/Web/API/HTMLCanvasElement/toDataURL)）导出，这是为了防止恶意网站借助 `canvas` 获取用户在其他网站上的图片。对于跨源 `script` 资源，只允许执行，不允许读取源代码，且语法错误无法被非同源的 script 捕获。其他标签也都有类似的限制，这里就不展开说了。
3. `form` 表单可以发送携带 Cookies 的跨域请求。

同源策略一定程度上保护了用户的安全，但其引入的诸多限制对开发者很不友好，考虑以下几种场景：

1. 网页需要通过 Ajax 获取在 CDN 服务器上托管的资源。
2. 获取自己另一个域名下的 `<img>` 并将其绘制在 `canvas` 上，随后需要将其转储为图片。

上面两种场景中，虽然存在跨源请求，但是两个 “源” 归属同一所有者，它们是可以互相信任的。然而同源策略不分敌友的一刀切政策，使得看上去很简单的需求难以实现。为了绕过这种限制，程序员摸索出了很多奇技淫巧，比较常见的就是 Jsonp，它利用的是 `script` 可以跨源的特性。我们看看它是如何让跨源请求 “绝处逢生” 的。

## 使用 JSONP 突破同源策略

JSONP 把跨源 Ajax 请求伪装成一个外部 script 资源，这是网页和目标网站之间的“秘密”，浏览器并不知情，因此浏览器会正常发送请求获取该外部脚本。重点来了，目标网站服务器返回的脚本并非普通的静态资源，而是根据请求动态生成的。这段脚本会将响应数据作为参数去调用发送请求时指定的回调函数，从而让客户端收到请求结果。这么说可能有点难理解，我们通过具体例子来说明。

网站 A (https://a.com) 想要发送 https://api.b.com/get-user-info 这样一个请求给服务器 B。由于跨源，请求无法以 Ajax 的形式发送，于是网站 A 的脚本动态地添加了一个 `script` 标签：

```javascript
function onGetUserInfoSuccess(data) {
  console.log(data);
}

function onGetUserInfoError(e) {
  console.log(e);
}

const script = document.createElement('script');
script.src = 'https://api.b.com/get-user-info?onsuccess=onGetUserInfoSuccess&onerror=onGetUserInfoError';
document.head.appendChild(script);
```

浏览器正常发送了这个外部脚本请求，服务器 B 返回的是：

```javascript
onGetUserInfoSuccess({"Name": "小明", "Id": 1823, "Rank": 7});
```

浏览器执行上述脚本，将响应数据传给了网页 A 的回调函数 `onGetUserInfoSuccess`。实际 JSONP 的做法和上述例子有点差异，但原理是一样的。这种跨院请求方案虽然绕过了浏览器的限制，但存在[安全隐患](https://zh.wikipedia.org/wiki/JSONP#%E5%AE%89%E5%85%A8%E5%95%8F%E9%A1%8C)，需要目标服务器做好防范措施。

奇技淫巧也只是权宜之计，大家还是希望能浏览器能原生支持受信任的跨源请求。千呼万唤之下，跨源资源共享（CORS）出现了。

## 迎接 CORS

CORS（跨源资源共享）是对同源策略下敌友不分的一刀切机制的改进。同源策略的问题在于，它假设所有网站都不被域名之外的服务器所信任，这种假设过于简单粗暴。防止敌人混入城堡的正确方式是在城门口配上守卫，对进城的人进行身份验证，而不是把城门焊死。CORS 是如何尽好守卫职责的呢？我们还是将跨源请求分为 Ajax 请求、标签资源请求和表单请求，逐个分析。

### Ajax 请求

出于对安全性和兼容性的考量，浏览器将 Ajax 请求分为简单请求和非简单请求。简单请求的定义见 MDN 对[简单请求的定义](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/Guides/CORS#%E7%AE%80%E5%8D%95%E8%AF%B7%E6%B1%82) ，不满足简单请求定义的便是非简单请求。我们先看非简单请求。

#### 非简单请求

如果一个请求被判定为非简单请求，浏览器会在发送正式的跨源请求之前，先发送一个 method 为 `OPTION` 的 **预检请求** 给目标服务器，询问目标服务器是否允许该网页给它发送跨源请求，若允许，目标服务器便可在响应中表明该许可，浏览器收到后会将正式请求发出，并将请求结果给到网页；若不允许或者干脆不响应，浏览器则不会发送正式请求，跨源请求宣告失败。与此同时，浏览器会在控制台打印 CORS 错误日志，便于开发者排查跨源请求失败的具体原因。

所谓询问服务器，其实就是在预检请求的请求中添加 `Origin` 头和 `Access-Control-Request-*` 头。其中：

- `Origin` 表示请求发起者的源，例如，https://foo.com/index.html 向 bar.com 发起请求，那么 `Origin` 就是 https://foo.com。

- `Access-Control-Request-*` 包括 `Access-Control-Request-Headers`，`Access-Control-Request-Method` 等，用来描述正式请求的那些不满足简单请求定义的特征，假如某个请求的 method 为 `DELETE`，`Content-Type`为 `application/json`，那么 `Access-Control-Request-Method` 就是 `DELETE`，`Access-Control-Request-Headers` 就是 `Content-Type`。

所谓表明许可，其实就是服务器在预检请求的响应中添加 `Access-Control-Allow-*` 头，用来答复请求头中的 `Access-Control-Request-*`。如果 `Access-Control-Allow-*` 的值包含了 `Access-Control-Request-*` 的值，表明该跨源请求被允许，反之不被允许。对于携带了 Cookies 的请求（如 `fetch` API 的 `credentials: 'include'` 和 `XMLHttpRequest` 的 `withCredentials=true` ），服务器需要在响应中额外添加 `Access-Control-Allow-Credentails: true` 头，且此时 `Access-Control-Request-Origin`、`Access-Control-Request-Headers` 的值不允许使用通配符 *，必须为具体值的列表，上述条件任何一个不满足，浏览器都不会发送正式请求。

#### 简单请求

对于简单的 Ajax 请求，浏览器不发送预检请求，而是直接发送正式请求，但服务器必须和响应非简单请求的预检请求一样，在这个正式请求的响应中包含 `Access-Control-Allow-*` 头，从而表明网页是否被允许读取响应数据，如果允许，浏览器便将响应数据返回给网页，否则丢弃，告诉网页请求失败（实际是请求成功了，只是给网页返回失败结果）。同样地，对于携带了 Cookies 的请求（如 `fetch` API 的 `credentials: 'include'` 和 `XMLHttpRequest` 的 `withCredentials=true` ），服务器需要在响应中额外添加 `Access-Control-Allow-Credentails: true` 头，且此时 `Access-Control-Request-Origin`、`Access-Control-Request-Headers` 等字段的值不允许使用通配符 *，必须为具体值的列表，上述条件任何一个不满足，浏览器都会丢弃响应数据，给网页返回请求失败的结果。

有几个问题值得探讨：

1. 浏览器为什么要违背同源策略的限制，不加任何限制就将简单请求发送给服务器？没有安全风险吗？

    简单请求是按照表单请求的特征来定义的，换句话说，简单请求是从 Ajax 中抽出来的、符合表单请求特征的那一类请求。我们知道，在 CORS 出现之前，同源策略就允许发送跨源表单请求，基于这个事实，浏览器假定服务器对于跨源表单请求存在的 CSRF 攻击早有防范，因此对于那些还没准备好迎接 CORS 的服务器而言，不加任何修改便能应对简单请求存在的 CSRF 攻击。从服务器的角度看，两者没有区别，服务器要是防不了简单请求的 CSRF 攻击，它同样防不了表单请求的 CSRF 攻击。简单请求没有引入额外的风险，但简单请求带来的额外的好处是，开发者被允许发送这类 Ajax 请求了，这在同源策略统治时期是不可能的。
2. 为什么服务器不在响应中添加 `Access-Control-Allow-*` ，浏览器就不把响应数据返回给网页呢？

    同源策略下，表单请求虽然能够发送请求，但拿不到结果，因为请求提交后浏览器就会刷新。在 CORS 出现之前，也许存在某些服务器，有意无意中依赖这种行为实现一定程度的安全性。引入 CORS 后，浏览器既然把简单请求作为表单请求的变体，就应当让两者行为及影响保持一致，从而不破坏现有服务器的安全性。于是浏览器就模仿表单请求，阻止网页拿到简单请求的响应，只有在服务器明确表示允许前提下，才将响应返回给网页。
3. 简单请求为什么不发送预检请求？

    简单请求作为表单请求的变体，直接发送并不会破坏同源策略，发送预检请求只会增加请求延迟。非简单请求就从来没被允许发送过，为了保持兼容，必须先通过预检请求征得服务器的同意才可发送正式请求。

### 标签资源请求

除了 Ajax，CORS 也对标签触发的跨源请求放开了限制。同源策略下，标签是被允许发送携带 Cookies 的跨源请求的，只是无法读取资源的内容，因此这里所说的限制是指对请求资源的读取限制。放开限制意味着破坏了同源策略，这当然是不行的，安全起见，支持 CORS 的浏览器必须对资源的 “读许可” 附加额外的条件，浏览器给开发者提供了两个选择：

1. 添加 `crossorigin="anonymous"` 属性，告诉浏览器请求资源时不需要附带任何代表用户身份的凭证 ，包括 Cookies 、 Authorization 和客户端证书，这样一来，浏览器请求到的就是非敏感数据，允许非敏感数据的读取不会有安全隐患。
2. 添加 `crossorigin="use-credentials"` 属性，告诉浏览器该请求需要携带代表用户身份的凭证，包括 Cookies 、 Authorization 和客户端证书。和简单的 Ajax 请求一样，包含 `crossorigin="use-credentials"` 属性的标签不会发送单独的预检请求来询问服务器的许可，而是将请求直接发送出去。服务器同样需要在响应头中通过 `Access-Control-Allow-*` 来表明许可。和前面那些附带 cookies 的请求一样，服务器必须在响应头中添加 `Access-Control-Allow-Credentails: true` ，且此时 `Access-Control-Request-Origin`、`Access-Control-Request-Headers` 等字段的值不允许使用通配符 *，必须为具体值的列表，上述条件任何一个不满足，浏览器都会回退到同源策略，限制网页对资源的读取，但资源仍可用于展示或执行，这样做同样是为了和同源策略保持兼容从而不破坏既有服务器的安全性。

### 表单请求

表单请求还是继续保持同源策略下的限制不变。我觉得这么做的原因可能是开发者很容易将表单请求迁移到 Ajax 请求来实现跨域资源共享，所以没有必要对表单请求制定一套 CORS 规则。

## 结语

关于 CORS 的更多玩法，大家感兴趣的话可以继续阅读 MDN 的相关[文档](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CORS)。本文很多地方是我自己的理解，有不对的地方还请不吝赐教。