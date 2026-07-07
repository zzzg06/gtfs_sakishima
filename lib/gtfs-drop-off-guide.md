# GTFS 降車制限設定ガイド

## 概要
GTFSデータで降車不可駅を設定するには、`stop_times.csv`ファイルの`pickup_type`と`drop_off_type`フィールドを使用します。

## 設定方法

### stop_times.csvに以下の列を追加：

\`\`\`csv
trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type
\`\`\`

### pickup_type / drop_off_type の値：

- **0** (または空白): 通常の乗降可能
- **1**: 乗車不可 / 降車不可
- **2**: 電話予約が必要
- **3**: 運転手に要連絡

## 実装例

\`\`\`csv
trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type,drop_off_type
trip_001,08:00:00,08:00:00,stop_A,1,0,0
trip_001,08:05:00,08:05:00,stop_B,2,0,1
trip_001,08:10:00,08:10:00,stop_C,3,0,0
\`\`\`

上記の例では：
- stop_A: 通常の乗降可能
- stop_B: 乗車は可能だが降車不可（通過駅）
- stop_C: 通常の乗降可能

## 乗換案内システムでの表示

システムは自動的に以下の警告を表示します：

- **降車不可 (drop_off_type=1)**: "⚠️ この駅では通常降車できません"
- **予約必要 (drop_off_type=2)**: "📞 事前予約が必要です"
- **運転手連絡 (drop_off_type=3)**: "🚌 運転手にお声がけください"

## 注意事項

- 乗り換え駅で降車不可の場合、特に目立つ警告が表示されます
- 最終到着駅での降車制限は通常設定しません
- 通過駅（停車するが乗降不可）の場合は pickup_type=1, drop_off_type=1 を設定
