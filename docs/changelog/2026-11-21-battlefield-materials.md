# 2026-11-21 君主列传战场材质

- 林地使用疏密错落的树群，常绿树、阔叶树与幼树有不同的高度和轮廓。林下补有落叶、苔藓和裸土，林缘留有空隙。继续沿用季节树冠图集与遮挡时淡出武将周边的处理。
- 城外主道、侧路改用有碎石的土路纹理，转弯处做圆滑衔接。石板沿城内街巷铺设，城池台基边缘采用缓坡。移动预览仍依据原路线和地格。
- 内陆河流和水壕使用灰绿水面，滨海呈青绿浅滩向深蓝外海过渡。夷洲三维水面延伸到沙盘之外，波纹相位与岛岸水面衔接。手机平面地图采用同一组岸边和外海配色。
- 地域战场的城墙采用斜收墙身、连续砌缝、压顶和带垛口的马道。拱门有独立券石和随突破开启的门扇，角楼采用有柱廊的翘檐屋面。洛阳和长安的南门仅在两侧都有既有墙格时向墙上扩展门楼，洛阳门前的低护墙保留中间通路。普通城池和关隘按原有规模绘制。平面版同步区分墙基、墙顶和城门。
- 四张 384×384 WebP 只在布局修订 6 的战场进入时请求。在提供当前材质的部署中，合计读取约 128 KiB 的新增素材。道路和地表一次烘焙，树林继续实例化。Docker 和桌面打包读取同一目录。加载失败可继续使用既有贴图或无贴图配色。

通行、机动力及存档结构使用原有规则。原版和按旧布局恢复的战斗沿用此前的显示方式。

## 材质来源

使用内置 ImageGen 生成原始四格材质图，再以 384×384 WebP 打包。水纹作为亮度纹理使用，颜色由岸线距离采样。

| 文件 | 材质 |
| --- | --- |
| [road-earth.webp](../../hd2d-mvp/assets/battle-textures/road-earth.webp) | 土路 |
| [court-stone.webp](../../hd2d-mvp/assets/battle-textures/court-stone.webp) | 城内铺石 |
| [water-ripples.webp](../../hd2d-mvp/assets/battle-textures/water-ripples.webp) | 水纹 |
| [woods-floor.webp](../../hd2d-mvp/assets/battle-textures/woods-floor.webp) | 林地地表 |

```text
Use case: stylized-concept. Create ONE square 1024×1024 production texture atlas for an original late Han Three Kingdoms strategy game's isometric HD-2D battlefield. Four equal 512×512 quadrants in an exact 2 by 2 grid with borders only where the surfaces meet. No gutters, labels, objects, people, framing, perspective or text. Each quadrant is an orthographic flat albedo swatch of a distinct material, low contrast, timeless painterly realism, uniform exposure with no baking of strong shadows. TOP LEFT: compacted dusty warm grey-beige cart-road earth with very fine gravel and natural sparse straw, faint soft variations, no tracks and no dominant shape. TOP RIGHT: weathered grey buff flagstone courtyard with many small irregular rectangular staggered slabs, subtle grout, patches of dust, tight planar joints, no grass and absolutely no diagonal perspective. BOTTOM LEFT: calm blue-green river water viewed perfectly straight down, quiet overlapping subtle ripples on a teal-grey surface with rare tiny glints, no foam bank, no caustic web, no strong reflection and no ocean waves. BOTTOM RIGHT: temperate East Asian woods floor with deep mossy olive, interspersed dark warm soil, very fine leaf litter and sparse soft grass, no trunks or trees. Keep each swatch internally uniform enough to tile seamlessly at its edges. Natural subdued colors, material detail at an approachable game scale.
```
