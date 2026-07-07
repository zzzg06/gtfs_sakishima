# GTFS列車情報の追加について

現在のGTFSデータに列車の行き先や種別を追加するには、以下の項目を使用してください：

## 1. 行き先情報
**trips.csv** に以下のカラムを追加：
- `trip_headsign`: 列車の行き先表示（例：「新宿行き」「快速 横浜行き」）
- `trip_short_name`: 列車番号（例：「1001M」「特急101号」）

## 2. 種別情報
**routes.csv** に以下のカラムを追加：
- `route_short_name`: 路線の略称（例：「JR山手線」「東急東横線」）
- `route_long_name`: 路線の正式名称
- `route_desc`: 路線の説明（種別情報を含む）
- `route_color`: 路線カラー（16進数、例：「00B04F」）

## 3. 追加の種別情報（オプション）
**trips.csv** に独自カラムを追加：
- `service_type`: 種別（例：「普通」「快速」「特急」）
- `train_type`: 列車タイプ（例：「各駅停車」「急行」）

## 4. 実装例
\`\`\`csv
# trips.csv の例
route_id,service_id,trip_id,trip_headsign,trip_short_name,service_type
JR_YAMANOTE,WEEKDAY,TRIP_001,新宿行き,1001M,普通
JR_YAMANOTE,WEEKDAY,TRIP_002,快速 池袋行き,1002M,快速

# routes.csv の例
route_id,route_short_name,route_long_name,route_type,route_color
JR_YAMANOTE,山手線,JR山手線,1,00B04F
\`\`\`

現在のシステムは `trip_headsign` を自動的に表示するよう実装済みです。
