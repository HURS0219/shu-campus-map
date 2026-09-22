# 上海大学宝山校区 · 校园地图 / 路网寻路 / 实时导航（PWA）

一个从 **OpenStreetMap 原始数据** 出发，构建 **校内可通行路网**，实现 **最短距离 / 最短时间寻路**，并打包成 **可在手机上离线寻路的 PWA** 的完整项目。

线上地址：**https://hurs0219.github.io/shu-campus-map/**
仓库：`HURS0219/shu-campus-map`（只包含 `pwa/` 的构建产物）

> 本文档写给后续接手的人 / AI，包含**做了什么、怎么做的、数据结构、坑、复现步骤、待改进点**。

---

## 0. 一句话概览

1. 从 OSM 抓取校区范围数据 → 2. 提取道路并建成"节点-边"图 → 3. 用 Dijkstra 按权重寻路（距离或时间）→ 4. 生成单文件网页（内联 Leaflet + 路网 + 算法）→ 5. 打包为 PWA 部署到 GitHub Pages。

---

## 1. 目录结构

```
shu_baoshan_map/
├─ README.md                     ← 本文件
├─ osm_raw.json                  ← OSM Overpass 原始数据（阶段一产物）
├─ shu_campus.geojson            ← 校区要素 GeoJSON（建筑/道路/水系/绿地）
├─ shu_campus.svg                ← 精密矢量底图（1 单位 = 1 米）
├─ shu_campus_preview.png        ← 底图预览
│
├─ 01_map/                       ← 阶段一：精密底图
│  ├─ fetch_osm.py               ← 调 Overpass API 抓取（bbox 见下）
│  ├─ osm_raw.json               ← 抓取结果副本（脚本按相对路径读写）
│  ├─ process.py                 ← OSM → 本地投影 → GeoJSON
│  ├─ render.py                  ← GeoJSON → SVG（1 单位 = 1 米）
│  └─ preview.py                 ← GeoJSON → PNG（matplotlib，需 CJK 字体）
│
└─ 02_roads_routing/             ← 阶段二~五：路网 / 寻路 / 应用
   ├─ extract_roads.py           ← OSM → graph.json + roads.geojson + roads_index.csv
   ├─ graph.json                 ← 路网图（1890 节点 / 2136 边 / 63.7 km）
   ├─ roads.geojson              ← 每条可通行道路的线要素（含宽度/等级）
   ├─ roads_index.csv            ← 道路指示表（名称/等级/宽度/长度/单行）
   ├─ routing.py                 ← Python 寻路（CLI + 库）
   ├─ visualize.py               ← 路网/路线可视化（PNG + SVG）
   ├─ serve.py                   ← 本地静态服务器（手机同 WiFi 调试用）
   ├─ build_app.py               ← 生成单文件 app.html
   ├─ build_pwa.py               ← 由 app.html 生成 pwa/
   ├─ fetch_tiles.py             ← 【已弃用】离线瓦片下载（见"坑"）
   ├─ app.html                   ← 单文件离线应用（约 310 KB）
   ├─ pwa/                       ← 可部署的 PWA（index.html / manifest / sw.js / icons）
   └─ web/                       ← 构建源
      ├─ app_template.html       ← 应用模板（含占位符）
      ├─ router.js               ← 寻路核心（纯 JS，可被 Node 测试）
      ├─ graph_compact.json      ← 压缩后的路网数据
      └─ vendor/leaflet.{js,css} ← 内联用 Leaflet 1.9.4
```

---

## 2. 数据管线

### 2.1 抓取（`01_map/fetch_osm.py`）
- 使用 **Overpass API**（`https://overpass-api.de/api/interpreter`）。
- 抓取 bbox：`S=31.3085, W=121.3795, N=31.3245, E=121.3985`（WGS-84）。
- 抓取内容：`building / highway / waterway / natural=water / leisure / landuse / barrier`。
- 结果约 6399 个元素，存 `osm_raw.json`。

### 2.2 提取与投影（`01_map/process.py`）
- 本地**等距圆柱投影**：`x=(lon-lon0)*111320*cos(lat0)`，`y=-(lat-lat0)*111320`，中心取 bbox 中心。
- 关系（multipolygon）取 `outer` 环，简化处理。
- 输出 GeoJSON，并按 `building / water / green / landuse / highway` 分类。

### 2.3 路网图构建（`02_roads_routing/extract_roads.py`）
- 遍历 `highway=*` 的 way，按 `ROAD_SPEC` 分类，切成相邻节点对（边）。
- 图：**节点 = OSM node（经纬度）**，**边 = 相邻节点对**，含长度（Haversine）、宽度、等级、单行、三种模式速度。
- 规模：**1890 节点 / 2136 边 / 总长 63.7 km**（arterial 182 / minor 1329 / foot 625）。

**道路分级与速度表（`ROAD_SPEC`，class, 宽度m, 步行, 骑行, 驾车 km/h）**：

| highway | class | 宽度 | 步行 | 骑行 | 驾车 |
|---|---|---|---|---|---|
| motorway/trunk | arterial | 22–24 | 0 | 0 | 45 |
| primary | arterial | 20 | 5 | 16 | 40 |
| secondary | arterial | 16 | 5 | 16 | 35 |
| tertiary | arterial | 13 | 5 | 16 | 30 |
| residential/unclassified | minor | 7 | 5 | 15 | 25 |
| living_street/service | minor | 4–5 | 5 | 12 | 15 |
| pedestrian | foot | 6 | 5 | 10 | 0 |
| footway/path | foot | 2–2.5 | 5 | 8 | 0 |
| steps | foot | 1.5 | 3 | 0 | 0 |

- **速度为 0 = 该模式禁行**。
- 宽度：优先 `width`，其次 `lanes×3.5`（仅主干道），否则用上表默认值。**OSM 里没有实测宽度，均为推算**。

---

## 3. 寻路算法

### 3.1 权重（`routing.py:129` / `router.js` `shortestPath`）
```
w = length                      # optimize = distance
w = length / (speed/3.6)        # optimize = time（秒）
```
同一条路，换权重就换最优解。

### 3.2 吸附（关键精度点）
不是"就近取节点"，而是**把点投影到最近的边**上，按投影点把边**切开**再寻路：
- Python：`Router.snap()` → `point_to_node()` → `_split_edge()`（会永久改图，注意重复调用会累积临时节点）。
- JS：`RouterCore.snap()` → `pointToNode()` → `splitEdge()`（同上）。
- **导航模式**为了避免图无限膨胀，改用 `nodeForCoord()`（吸附后取较近端点，不切边），精度损失约几米。

### 3.3 单行 / 禁行
- 只有 `car` 模式尊重 `oneway`（`yes/1/true` 正向，`-1/reverse` 反向）。
- 步行/骑行忽略单行。
- `access=private/no` 且未标 `foot=yes` 视为不可通行。

### 3.4 转向指引
- 把连续边按 `(name, hw, class)` 分组，计算组间方位角差：
  - `|Δ|>150°` 掉头，`Δ>30°` 右转，`Δ<-30°` 左转，否则直行。

---

## 4. Web 应用

### 4.1 构建链
```
web/app_template.html  +  web/router.js  +  web/graph_compact.json  +  web/vendor/leaflet.*
        └──────────────────── build_app.py ────────────────────┘
                                   ↓
                              app.html（单文件）
                                   ↓ build_pwa.py
                          pwa/（index.html + manifest + sw.js + icons）
```
- **`app.html` 单文件**：Leaflet、寻路算法、路网数据全部内联，**路网与寻路完全离线**；底图用在线 OSM 瓦片。
- 修改 UI 改 `web/app_template.html`；修改算法改 `web/router.js`；改完跑 `python build_app.py && python build_pwa.py`。

### 4.2 `router.js` 数据结构（压缩格式）
```js
data = {
  nodes: [[lon,lat], ...],
  edges: [[u, v, len, width, cls, vFoot, vBike, vCar, oneway, nameIdx, hwIdx], ...],
  names: ["", "上大路", ...],
  hws:   ["", "primary", ...]
}
// cls: 0=arterial(大路) 1=minor(小路) 2=foot(步行道)
// oneway: 0=无 1=正向 2? 实际: 1=u->v, -1=v->u
```
- `RouterCore` 提供：`snap / pointToNode / shortestPath / directions / route`。
- 可被 Node 直接 `require` 测试（见"复现"）。

### 4.3 交互功能（当前版本）
| 功能 | 说明 |
|---|---|
| 点图设起终点 | 第一次点=起点，第二次=终点，第三次重设起点 |
| 步行/骑行/驾车 | 切换路网与速度 |
| 最短距离/最短时间 | 切换权重 |
| 规划路线 | 画红线 + 全程距离/时间 + 逐段转向 |
| 互换 | 起终点互换 |
| 定位 | `watchPosition` 实时定位（蓝点 + 精度圈） |
| 跟随 | 地图自动跟随；拖动地图自动关闭 |
| 方向 | 指南针：iOS 用 `webkitCompassHeading`，安卓用 `deviceorientationabsolute`，兜底相对 `alpha`；含**手动校准**（对准北点"校准"，`−/+` 微调磁偏角，偏移存 localStorage） |
| 朝向箭头 | 蓝点上的实心箭头 + 半透明扇形（需**已有定位**才显示） |
| 导航模式 | 独立开关：起点=实时位置，终点=地图点选，每 ~3s 重算，显示**剩余距离/时间 + 预计到达** |
| 分享链接 | `#route=lon1,lat1,lon2,lat2&mode=foot&opt=time` 打开即自动规划 |

---

## 5. PWA 与部署

- `pwa/` 内容：`index.html`（= app.html + PWA 标签 + SW 注册）、`manifest.webmanifest`、`sw.js`、`icons/`、`.nojekyll`。
- **Service Worker**：同源资源**缓存优先**；OSM 瓦片**运行时缓存**（联网时用在线瓦片并缓存已访问区域）。
- **部署（GitHub Pages）**：
  ```powershell
  cd 02_roads_routing\pwa
  git add -A; git commit -m "update"; git push
  ```
  约 1 分钟后生效。
- **手机上装成 App**：iPhone Safari → 分享 → 添加到主屏幕；安卓 Chrome → 安装应用。

---

## 6. 坐标系（重要，极易踩坑）

- 本项目**全部使用 WGS-84**（OSM / Leaflet / 我们的路网一致）。
- **高德 / 腾讯使用 GCJ-02（火星坐标）**，与 WGS-84 在国内相差约 **500 米**。若要接它们，必须做 WGS-84 ⇄ GCJ-02 转换。
- 历史版本（备份 v4–v8）曾集成 **高德 / 腾讯 / Valhalla** 做在线 ETA 对照，已按要求移除；相关代码在备份 zip 中可找回。腾讯的 polyline 是**增量编码的扁平数组**（首点为绝对 lat,lng，其后为 1e-6 度增量），当时踩过坑。

---

## 7. 已知问题 / TODO

1. **定位精度**：手机 GPS 在室内/树下 10–50 m，属硬件限制；已用 `watchPosition` 取最优并显示精度圈，但无法根治。
2. **朝向箭头依赖定位**：没有 GPS 定位就不显示（右上角指南针不受影响）。
3. **指南针可能是"相对方向"**：部分设备只给相对 `alpha`，指针不指北，需手动校准；校准基于陀螺仪会缓慢漂移。
4. **ETA 是估算**：固定速度、**无路口转向惩罚、无实时路况**，绝对时间误差较大（步行 ±20–40%），相对比较更可靠。
5. **离线瓦片已放弃**：曾批量下载 OSM 瓦片（`fetch_tiles.py`），**触发 OSM 使用政策被封 IP（403）**，已回退为纯在线瓦片。**不要再批量抓取 OSM 瓦片**；如需离线底图请用正规瓦片服务或自建。
6. **`pointToNode` 会永久改图**：频繁调用（如导航）会累积临时节点，导航已改用 `nodeForCoord` 规避。
7. **待做**：地图随朝向旋转（需 leaflet-rotate 插件）、转向惩罚、真实速度标定、偏航重规划提示。

---

## 8. 复现步骤

```powershell
# 阶段一：底图（需要联网）
cd 01_map
python fetch_osm.py        # -> osm_raw.json
python process.py          # -> shu_campus.geojson
python render.py           # -> shu_campus.svg
python preview.py          # -> shu_campus_preview.png（需 matplotlib + 中文字体）

# 阶段二~四：路网与单文件应用
cd ..\02_roads_routing
python extract_roads.py    # -> graph.json, roads.geojson, roads_index.csv
python build_app.py        # -> app.html, web/graph_compact.json
python build_pwa.py        # -> pwa/

# 本地调试（手机同 WiFi）
python serve.py            # http://<电脑IP>:8000/app.html

# 命令行寻路
python routing.py --from "121.39160,31.31600" --to "121.38850,31.30950" --mode foot --optimize time

# Node 校验寻路核心（应与 Python 结果一致）
node -e "const {RouterCore}=require('./web/router.js');const d=require('./web/graph_compact.json');const r=new RouterCore(d);console.log(r.route(121.3916,31.316,121.3885,31.3095,'foot','time').length)"
```

依赖：Python 3.11+（`matplotlib` 用于出图/图标，可选）；Node（仅用于测试）；Leaflet 1.9.4（已内联，无需安装）。

---

## 9. 备份与版本

`C:\Users\zhong\shu_baoshan_map_backups\`（文件夹 + zip）：

| 版本 | 内容 |
|---|---|
| v1 | 精密底图（SVG/GeoJSON） |
| v2 | 路网提取 + Python 寻路 |
| v3 | 单文件网页应用（第一个可用版本） |
| v4 | 接入高德 API（对照） |
| v5 | 接入 Valhalla（免 Key 对照） |
| v6–v7 | 接入腾讯 + polyline 增量解码修复 |
| v8 | 三路对照出图 |
| v9 | **清理为纯单机版**（= v3 + 措辞） |
| v10 | 定位改进（watchPosition / 精度圈 / 吸附） |
| v11 | 实时定位 + 指南针 |
| v12 | PWA 打包 |
| v13 | 回退为在线瓦片 |
| （之后） | 指南针指北修复 + 校准、朝向箭头、导航模式 |

---

## 10. 给接手的 AI 的建议

- **改 UI** → `web/app_template.html`；**改算法/数据格式** → `web/router.js` 与 `extract_roads.py`；改完**必须**重跑 `build_app.py` 再 `build_pwa.py`。
- **不要在 `pwa/` 里直接改**（会被 `build_pwa.py` 覆盖，除 `.git` 外）。
- **坐标永远是 WGS-84**；接国内服务记得 GCJ-02 转换。
- **不要批量下载 OSM 瓦片**（政策封 IP）。
- **手机定位/传感器必须 HTTPS**（`file://` 和 `http://局域网IP` 在手机上多数被拒）。
- 改完部署后，用户端 **Service Worker 有缓存**，需下拉刷新两次或重装主屏图标才能看到新版。
- 验证寻路：用 Node 跑 `RouterCore` 与 Python `routing.py` 对同一起终点，结果应一致。
```
