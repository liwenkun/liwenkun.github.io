---
layout:     post
title:      "树莓派 3B+ 刷 OpenWrt 并安装 OpenClash"
subtitle:  
date:       2024-03-29
author:     "Chance"
catalog:  true
tags:
    - 折腾
---

<div class='img-no-shadow'>

# 前言

心血来潮打开了尘封已久的 switch，发现软件更新实在太慢，上网找了几种常用的加速方法，但最终都被 pass：

   - 更改 DNS 服务器，缺点是网速提升有限，大概在 34 Mbps 左右，大概提升 1 ~ 2 Mbps 左右 ，相对 switch 几百 M 几个 G 的游戏来说，依然是龟速。唯一的好处是不用借助其他设备。
   - 买加速器。对于喜欢折腾的人来说，花钱永远是最后的选择，况且我自己有梯子，干嘛花这个冤枉钱。
   - 把电脑上的代理通过局域网分享给 switch，然而发现网速的提升依然不高，虽然后来发现是 USB 无线网卡的问题，但不管怎样，电脑一直保持开机状态，就是为了给 switch 做代理，总感觉不太优雅。

要是能在路由器上跑代理就好了，不过现在的路由器不支持装插件，而且是公用的，不太适合去折腾。这时候突然想起了我还有个同样在吃灰的树莓派，如果能把这台树莓派变成一台软路由，再在这个软路由上跑代理，岂不美哉？对比几款软路由之后，我最终选择了 OpenWrt，一是因为它插件比较多，有更多可玩性，二是用户量大，教程多，遇到问题容易找到解决方案。

话不多说，开干。
<!-- more -->

<p class="notice-info">如果你的设备也是树莓派 3B+ 且不想折腾的话，我这里准备了一个开箱即用的 OpenWrt 镜像，可以用作二级路由用，如果你是通过 PPPoE 拨号上网，只需要编辑 wan 接口，将其协议改成 PPPoE，填写宽带用户名和密码就行了。镜像自带 OpenClash，分区扩容到了 1G，路由器管理密码和 WiFi 密码都是 12345678，WiFi 名为 OpenWrt，路由器地址为 192.168.110.1。烧录运行后，只需要改下密码和 OpenClash 节点信息就行了。  
<a href='https://cloud.189.cn/t/3iqiYfYRnA3e'>天翼云盘（访问码：ba8p）</a> 或者 <a href='https://1drv.ms/u/s!Avz7vfylhEW5kyy60lACnqFGODSC?e=lPcP9v'>OneDrive</a></p>

# 安装 OpenWrt

## 准备工具
* 1G  以上 micro SD 卡，树莓派 3B+，网线
* 镜像烧录工具 [balenaEtcher](https://etcher.balena.io/)

## 下载镜像

首先是去 OpenWRT 官网找自己的设备对应的固件，去到官网[下载页](https://openwrt.org/downloads)：

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/iShot_2024-03-26_18.29.16-20240326183441-5anzd6b.png)

点击 *Table of Hardware*，进入到硬件列表页面：

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/iShot_2024-03-26_18.34.00-20240326183736-bt1r00z.png)

在输入框里输入关键字筛选，然后在列表中找到自己的型号。我的板子型号是 3B+，因此选择下载 3B+ 对应的固件。一共有四种固件可供选择，分别是 release 和 snapshot 版本的完整镜像及其升级包。由于我是全新安装，因此选择完整镜像就行了，这里我选择的是 release 版本的完整镜像 Factory image。

<p class="notice-warn">注意，如果你选择 snapshot 版本的镜像，可能会遇到一些坑，因为 snapshot 固件的软件仓库没有进行版本隔离，软件仓库中的软件永远是适配最新版固件的，因此后面你安装软件的时候，可能会出现兼容性问题。当然，你可以手动更换到固定版本的软件仓库来解决这个问题，如何更换后面会提到。</p>

## 烧录镜像

下载好镜像后解压得到 openwrt-23.05.0-bcm27xx-bcm2710-rpi-3-ext4-factory.img，然后使用 balenaEtcher 镜像烧录工具，把固件烧录到我们的存储卡中，存储卡不用很大，1G 足够了：
![](/img/in-post/post_install_openwrt_with_raspi_3bplus/iShot_2024-03-26_19.12.13-20240326191339-qij64pw.png)
烧录完成之后，把 SD 卡插入树莓派，通上电，就可以开始配置了。

## 配置 OpenWrt

1. 登录路由器管理后台
   
    OpenWrt 无线网卡默认是未启用状态，因此没法通过 WiFi 连接并登录路由器管理界面。我们把树莓派通过网线连接到电脑，然后去电脑的设置里查看有线网络的网关 IP，一般都是 192.168.1.1，在浏览器中输入这个 IP 就可以看到 OpenWrt 的管理界面了：

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326194314-eajrdzi.png)

2. 修改密码，添加 SSH 公钥

    我们还没有设置过密码，直接点击 Login 就行。登录之后会提示你设置路由器后台密码，点击 <kbd>Go to password configuration...</kbd>。你还可以添加电脑的 SSH 公钥，方便后续 SSH 登录。

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326194753-8tm3r0q.png)

3. 研究一下初始配置（不感兴趣的话可略过）

    去到 Network -> Interface 界面，可以看到只有一个 lan 接口：

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326200811-2btw7q2.png)

    点击编辑先研究下配置：

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326201907-648ify0.png)

    可以看到这个接口配置的是静态 IP，接口关联的设备是 br-lan 网桥，在这个接口上跑了一个 DHCP 服务器。点击 <kbd>Dismiss</kbd> ，切换到 <kbd>Devices</kbd> 选项卡，研究下 br-lan 网桥的配置。可以看到 br-lan上附加了一个 eth0，eth0 是树莓派的有线网卡。电脑通过网线连接到路由器，就成功地和路由器建立了链路层的连接，又因为路由器在这个接口上配置了 DHCP 服务器，因此同一链路上的电脑作为 DHCP 客户端自动获得了 IP，加入到了路由器所创建的局域网中。这就是为什么电脑连接树莓派后，不需要任何配置就能获取 IP 和网关，访问路由器后台。

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326202341-cq4z8dc.png)

    然而现在也只能访问路由器后台，没法联网。为了能联网，我们需要完成以下配置：
    * 创建 wan 接口，并让其作为 DCHP 客户端去连接上层路由器；
    * 修改现在的 lan 接口，让其关联的设备是无线网卡而非现在的以太网卡；
    * 配置并激活无线网卡，开启无线网络，让局域网的无线设备能够连接进来；

    以上是配置思路，接下来说下具体方法。

4. 创建 wan 接口。

    在 Network -> Interface 页面，点击 <kbd>Add new interface...</kbd> ：

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326214821-aaka330.png)

    填入下图所示配置，然后点击 <kbd>Create interface</kbd>：

     Device 选择 br-lan 网桥也行，但网桥上只附加了一个 eth0，就没有使用的必要了，直接用 eth0 就行，br-lan 后面可以直接删了。

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326214928-6h67ux3.png)

    在新弹出的窗口中，点击 <kbd>Save</kbd>：
    
    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326214543-mu1mmpq.png)

5. 开启无线网络，创建无线局域网。

    点击 lan 接口的 <kbd>Edit</kbd> 按钮，修改其配置：

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326215639-zem4of6.png)

    如下图所示，将 Device 改成 <kbd>Wireless Network: Master &quot;OpenWrt&quot; (lan)</kbd>，Device 展示的名称和选项列表中的名称不一样，这个不用管。IPv4 address 改成 192.168.110.1。然后点击  <kbd>Save</kbd> 保存。

    <p class="notice-error">如果你上级路由器的网段不是 192.168.1.0/24，这里 IPv4 address 其实可以不改，我这里之所以改成 192.168.110.1 是避免上级路由器网段冲突。如果你的上级路由器网段刚好也是这个，你可以去买彩票了 😃。</p>

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327212906-2rovyqk.png)

    然后我们去到 Network -> Wireless ，点击 <kbd>Edit</kbd> 按钮配置一下无线网络：

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326215538-hwck292.png)

    如下图所示，把 Channel 改成 44（最开始我用的是 auto，发现 switch 死活连不上，最后按照网上的方法改成 44 就好了），加密方式我选择的是 <kbd>WPA-PSK/WPA2-PSK Mixed Mode</kbd>，兼容性好一点。 Key 自己看着填就行。最后点击 <kbd>Save</kbd>。

    <p class="notice-error">在上述配置完成之前，不要在这个配置页面点击 <kbd>Enable</kbd> ，<kbd>Enable</kbd> 除了会开启无线网络，还是把之前所有的更改强制应用了，如果只配置到一半，可能会导致无法再连接上路由器。</p>

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327175237-uznxcji.png)

    退出配置后，回到上级界面，点击 <kbd>Enable</kbd>：
    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326220445-i2vek52.png)

    这一步会不仅会激活无线网卡并开启其无线 AP 功能，还有将之前所有的配置都应用。页面上会显示 Applying configuration changes 的 90s 倒计时，你需要在 90s 之内连接到 OpenWrt ，否则配置就会回滚。

    ![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326220558-odd0f0m.png)

    找到名为 OpenWrt 的无线网络，连接成功以后页面会自动刷新，配置应用成功。现在可以断开树莓派和电脑的连接，把树莓派连到路由器的 lan 口上。不出意外的话，就能愉快地上网了。

# 安装 OpenClash

软路由配置好了，接下来可以装代理软件了，我选择的是 OpenClash，原因也是一样，可玩性还行，并且有一定的用户量。就是配置稍微麻烦点。

## 更换 OpenWrt 软件源

在搭 OpenClash 之前我们需要更换一下 OpenWrt 的软件源，否则软件包的下载可能会很慢。去到 System -> Software，点击 <kbd>Configure opkg...</kbd>，如下图所示：

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240326232628-2vbn56z.png)
![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327175032-uhrt175.png)

然后把下面的文本复制到红框中，取代官方的源，点击 <kbd>Save</kbd>。我这里用的是清华的源，速度还可以。

 <p class="notice-error">确认一下版本和 CPU 架构是否能和你的设备对上，否则需要修改</p>

```bash
src/gz openwrt_core https://mirrors.tuna.tsinghua.edu.cn/openwrt/releases/23.05.0/targets/bcm27xx/bcm2710/packages
src/gz openwrt_base https://mirrors.tuna.tsinghua.edu.cn/openwrt/releases/23.05.0/packages/aarch64_cortex-a53/base
src/gz openwrt_luci https://mirrors.tuna.tsinghua.edu.cn/openwrt/releases/23.05.0/packages/aarch64_cortex-a53/luci
src/gz openwrt_packages https://mirrors.tuna.tsinghua.edu.cn/openwrt/releases/23.05.0/packages/aarch64_cortex-a53/packages
src/gz openwrt_routing https://mirrors.tuna.tsinghua.edu.cn/openwrt/releases/23.05.0/packages/aarch64_cortex-a53/routing
src/gz openwrt_telephony https://mirrors.tuna.tsinghua.edu.cn/openwrt/releases/23.05.0/packages/aarch64_cortex-a53/telephony
```

## 安装 OpenClash

因为 OpenWrt 软件仓库里并没有提供 OpenClash，我们需要去 [OpenClash Github Release](https://github.com/vernesong/OpenClash/releases) 页下载最新的 ipk 包：

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327154738-dmo7m40.png)

然后按照 Release 页的说明，先通过 ssh 登录软路由（密码是你一开始设置的路由器管理密码）：

```bash
➜  ssh root@192.168.1.1
```

再执行 `opkg update` 命令以获取最新的软件包列表：

```bash
root@OpenWrt:~# opkg update
```

接着安装 OpenClash 依赖，根据所使用的防火墙，选择不同的依赖，我用的是 nftables：

```bash
root@OpenWrt:~# opkg install coreutils-nohup bash dnsmasq-full curl ca-certificates ipset ip-full libcap libcap-bin ruby ruby-yaml kmod-tun kmod-inet-diag unzip kmod-nft-tproxy luci-compat luci luci-base
```

不出意外的话，两三分钟的时间就装好了，你可以先去撒泡尿，喝口水。

依赖安装好后，就可以安装 OpenClash 了。去到 System -> Software，点击 <kbd>Upload Package...</kbd>：

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327000024-x2yn023.png)

点击<kbd>Browse...</kbd> 选择之前下载的 ipk 包，点击 <kbd>Upload</kbd>，然后点击 <kbd>Install</kbd>：

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327174856-8qyj9ua.png)

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327000414-devs5oj.png)

这个时候可能会失败：

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327001159-g637mgk.png)

看错误信息貌似是 dnsmasq-full 和已经安装的 dnsmasq 有冲突，看名字 dnsmasq-full 应该是比 dnsmasq 功能更全面的包，所以我们可以把 dnsmasq 卸载了。我们在 <kbd>Installed</kbd> 标签页筛出这个包来，点击 <kbd>Remove</kbd>。（直接在 ssh 里执行 `opkg remove dnsmasq` 也行）

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327175721-f2e296c.png)

再次安装 OpenClash ipk 包，不出意外的话就装好了。可能会弹出 XHR 错误，忽略它。重启路由器，会发现顶部菜单栏多出了一个 <kbd>Service</kbd>，OpenClash 入口就在这个菜单下。点击进到 OpenClash 页，这时候 OpenClash 会提示你安装内核，点击 <kbd>Install</kbd> 进行安装。然后会自动跳转到日志页展示内核的安装日志，我这里的日志显示是安装成功了，如果你安装失败了，就得手动下载内核放到指定目录，可以去网上搜一下，很简单。

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327002040-uww3k9k.png)

## 编辑 OpenClash 配置

回到 OpenClash，切换到 <kbd>Config Manage</kbd> 选项卡，滑到下面的 **Config File Edit** 编辑你的配置。左边是编辑区，右边的是运行时配置预览区。如果你手里已经有配置文件，只需要把它粘贴到左边就行了：

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/iShot_2024-03-27_17.44.52-20240327174525-vnc67e7.png)

这里附上一个我自用的模板，有两个留空的 SS 节点，替换一下就行：

[https://cloud.189.cn/t/RnyYvymuQzYz](https://cloud.189.cn/t/RnyYvymuQzYz)（访问码：7iv6）

编辑完成后，点击下面的 <kbd>Apply Settings</kbd> ，这时候 OpenClash 会重启，重启完之后，不出意外的话，这时候再让 switch 连上 OpenWrt，下载速度应该快到飞起。当然，前提是你的线路本身足够快 : ) 。

OpenWrt 还有很多可以折腾的地方，可以换语言，换主题，装插件。这个我就不再细说了，大家可以去网上搜索教程。我反正是折腾了一圈，最后还用回了官方的主题。还是官方主题用起来顺手，特别是顶部菜单的设计，鼠标悬浮就能展开二级菜单，有些主题菜单在侧边栏，需要点击一级菜单才能展开二级菜单，有点麻烦。

如果你还是想继续折腾，折腾之前不妨先接着往下看。

# 扩容和备份

## 扩容
<p class="notice-warn">后来我才知道下面这种方法只对 rootfs 是 ext4 的固件有效，如果 rootfs 是 squashfs + overlay，就不起作用了。如果固件的 rootfs 是 squashfs + overlay 文件系统，请参考这篇文章进行扩容：<a href="https://www.techkoala.net/openwrt_resize/">OpenWRT overlay 空间扩容
</a>，备用连接：<a href="https://web.archive.org/web/20250724024336/https://www.techkoala.net/openwrt_resize/">OpenWRT overlay 空间扩容 - WebArchive</a></p>

不管你的 SD 卡有多大，烧完 OpenWrt 后，rootfs 分区也只剩下几十 M 的空间，折腾的时候极有可能会遇到磁盘空间不足的情况。因此我们先对 OpenWrt 做一下扩容，先把它扩到 1G。

<p class="notice-info">当然，你也可以扩容到更大，但因为后面要对分区进行备份，分区太大备份要花较长时间，建议折腾完后再扩容到最大。</p>

我用的分区工具是 Linux 平台的 Gparted，Windows 的傲梅分区助手应该也行。打开 Gparted，右上角选择 SD 卡，然后右键 rootfs 分区调出上下文菜单，点击 <kbd>调整大小/移动</kbd>。

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327162940-5i85bfe.png)

输入分区的新大小（也可以用上面的滑块来调整），然后点击 <kbd>调整大小/移动</kbd>，最后点击  **<kbd>✔</kbd>** 提交。

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327163736-1p10m54.png)

OK，分区现在有 1G 了，你可以尽情去折腾了。

## 备份

折腾的过程中软路由可能会变砖，因此我们要养成一个好习惯，经常做下备份，留个检查点，不至于前功尽弃。其实 OpenWrt 自己就有备份的功能，但它备份的是 /etc 目录，假如某个软件的配置文件存在其他地方，恢复的时候就可能出现一些奇奇怪怪的问题。更稳妥的备份方法当然是把分区给备份下来，扩容后分区的总大小也只有 1G 左右，完整备份也不费事。我这里用来备份的工具是 Windows 平台的 Win32DiskImager，Mac 平台和 Linux 平台应该也有类似的工具，大家可以去找一下。

我们先创建一个名为 openwrt_backup.img 的空文件，然后打开 Win32DiskImager，映像文件选择我们刚创建的 openwrt_backup.img，设备选择 SD 卡对应的盘符，勾选 <kbd>仅读取已分配分区</kbd>，然后点击<kbd>读取</kbd>，接着 SD 卡中的内容就会读入到 openwrt_back.img 中了。备份过程中可能会出现 “剩余空间错误” 的弹窗，直接忽略。

![](/img/in-post/post_install_openwrt_with_raspi_3bplus/image-20240327174028-zp05qsw.png)

恢复的方法和前面烧录镜像的方法一样。

<p class="notice-info"> 其实 Win32DiskImager 也能实现烧录，步骤和上面一样，只是把 <kbd>读取</kbd> 改成 <kbd>写入</kbd>。</p>

# 结语

OK，分享到此结束。祝大家玩得开心！

‍</div>
