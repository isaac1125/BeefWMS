# BeefWMS 牛肉庫存管理平台（Vue 3 + Vite + Supabase）

行動優先 UI、黃色主題、以「包」管理庫存；秤重只在 `/billing` 輸入斤/兩計價。

## 功能對應

- `/` Dashboard
  - 各品項庫存（包數，`<10` 紅色警示）
  - 各客戶欠款總額（彙整 `billing_records.current_debt > 0`）
  - 今日 `pending` 待秤重取貨單
  - 三個大按鈕：`新增入庫` / `登記取貨` / `秤重結帳`
- `/inventory` 入庫管理（週一週起始）
  - 輸入 `上週剩餘(包數)` + `本週入庫(包數)`，自動算 `本週總剩餘`
  - 儲存到 `inventory_records`
- `/pickups` 取貨登記
  - 全部只建立「包數」到 `pickups.quantity`
  - 建立後會立即反映 Dashboard 庫存（此專案用 pickups 動態扣減，不更新 inventory_records）
  - 秤重品項的實際重量在 `/billing` 才輸入
- `/billing` 秤重結帳
  - 對 `pending` pickups 計算總金額並寫入 `billing_records`
  - 秤重品項用 `斤兩 -> 16進位兩數` 計算：`totalLiang = jin*16 + liang`
  - 更新 pickups 狀態為 `billed`
- `/pricing` 定價維護（重點）
  - 選客戶後編輯 7 品項「單價」
  - 客戶未設時會回退 `items.default_price_per_jin/default_price_per_unit`
  - 儲存後用 upsert 寫入 `customer_item_prices`
- `/customers`、`/items` CRUD

## 本地端設定

### 1) 安裝與啟動

```bash
cd frontend
npm install
npm run dev
```

### 2) 環境變數

Vite 會讀取：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

你可以參考 `frontend/.env.example`；實際值放在 `frontend/.env.local`。

## Supabase 建表與種子資料

在 Supabase SQL Editor 依序執行：

1. 建表：
   - `supabase/schema.sql`
2. 插入預設資料：
   - `supabase/seed.sql`

`customer_item_prices` 預設會維持空表，讓 `/pricing` 後台維護生效。

## 計算邏輯（與資料庫一致）

- 定價：
  - `/pricing` 寫入 `customer_item_prices`
  - 若查不到該客戶+品項：回退 `items` 預設價
- 庫存（包數）：
  - Dashboard on-hand：`inventory_records.this_week_total - pickups 已建立(非 cancelled)的包數`
  - 本專案採「Dashboard 端動態扣減」：不在 `/pickups` 直接修改 `inventory_records`
- 秤重金額：
  - `totalLiang = jin*16 + liang`
  - `totalAmount = totalLiang * (pricePerJin / 16)`

## 部署（Netlify / Vercel）

此專案是 SPA，部署時需確保路由回退到 `index.html`。

### Netlify

- Build command：`npm run build`
- Publish directory：`frontend/dist`
- 網站路由規則：所有路徑重寫到 `/index.html`（SPA fallback）

### Vercel

- Build command：`npm run build`
- Output directory：`frontend/dist`
- Framework：Vue（或自行設定 SPA fallback）

## 專案結構（重點）

- `frontend/src/lib/supabase.ts`：Supabase client + `getCustomerItemPrice(customerId, itemId)`
- `frontend/src/lib/weight.ts`：斤兩 16進位計算
- `frontend/src/pages/*Page.vue`：各頁面與 CRUD

