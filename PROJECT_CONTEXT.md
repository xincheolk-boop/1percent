# 1% Trading PRO - 종합 프로젝트 컨텍스트
> 마지막 업데이트: 2026-03-09
> 마지막 커밋: 3f1aca0 (2026-03-06) - 거래소 이벤트 실제 배너 이미지 + i18n 전체 일관성 수정

---

## 📌 전체 비전 & 사이클

```
1% Trading PRO = 암호화폐 종합 플랫폼

한 사이클 구조:
┌─────────────────────────────────────────────────┐
│  1. 플랫폼 개발 ──→ 2. 봇/자동화 ──→ 3. 마케팅/SNS │
│       ↑                                    ↓        │
│  6. SNS자동화 ←── 5. 매매일지 ←── 4. 트레이딩     │
└─────────────────────────────────────────────────┘

목표: CoinGlass, CoinGecko, CoinMarketCap 수준의 종합 플랫폼
차별점: 리퍼럴 페이백 + 실시간 데이터 + 매매일지 + 커뮤니티
미래 계획:
- CFD 데이터 통합 (거래소 출시 대비 선제 세팅)
- 페이백 전용 자회사 플랫폼
- 온체인 데이터 전용 플랫폼
- 트레이딩 매매봇 (Bitget 연동)
```

---

## 🏗️ 기술스택 (공통)

```
백엔드: Cloudflare Workers (worker.js 단일 파일, ~1,927줄)
DB: Cloudflare D1 (SQLite 기반)
프론트엔드: Vanilla HTML/CSS/JS (38개 HTML 파일, 프레임워크 없음)
배포: wrangler deploy (Cloudflare)
의존성: @cloudflare/kv-asset-handler 1개만
크론: 0 */6 * * * (커미션 수집 + 이벤트 크롤링)
스타일: Orbitron + Noto Sans KR + JetBrains Mono, 다크테마
다국어: 한/영/일/중 지원
```

---

## 📂 디렉토리 구조

```
/home/user/1percent/
├── worker.js              ← 전체 백엔드 (모든 API)
├── wrangler.toml           ← 배포/DB 설정
├── package.json
├── schema.sql              ← DB 스키마 v1
├── schema_v2.sql           ← DB 스키마 v2 (인증 추가)
├── index.html              ← 메인 대시보드
├── admin.html              ← 관리자 (82KB, 대규모)
├── mypage.html             ← 유저 마이페이지
├── register.html           ← UID 등록
├── journal.html            ← 매매일지 (프론트만, 백엔드 없음)
├── events.html / calendar.html / news.html
├── bitget.html / okx.html / gate.html
├── kimp.html               ← 김치프리미엄
├── exchanges.html          ← 거래소 목록 + 명예의전당
├── contract/
│   ├── liquidation.html    ← 청산
│   ├── funding.html        ← 펀딩비
│   ├── longshort.html      ← 롱숏비율
│   └── oi.html             ← 미결제약정
├── market_structure*.html / ict_pd_arrays.html / engulfing_pattern.html
├── img/
└── 727k-pro-*.html         ← 구버전 파일들
```

---

## 💾 DB 테이블 전체

```sql
-- v1 (schema.sql)
users(id, nickname, uid, exchange, telegram, join_date, status)
settlements(id, user_id, exchange, month, volume, fee, payback_amount, status, paid_date)
events(id, exchange, title, description, image_url, link, start_date, end_date, is_active, featured, sort_order)
banners(id, title, image_url, link, position, is_active)
notices(id, title, content, is_pinned)

-- v2 (schema_v2.sql) 인증 추가
accounts(id, email, password_hash, nickname, referral_code_used, my_referral_code, agreed_terms, agreed_privacy, status)
sessions(id, account_id, token, expires_at)
users += account_id (FK → accounts)

-- worker.js에서 사용하지만 스키마 파일에 없는 테이블 (D1에 직접 생성된 것)
exchange_api_configs(id, exchange, api_key_enc, api_secret_enc, passphrase_enc, platform_rate, user_rate, is_active, last_sync, last_sync_status)
commissions(id, exchange, invitee_uid, order_id, commission_time, trade_type, token, trading_fee, net_fee, platform_rate, user_rate, platform_commission, user_commission, raw_data)
commission_summaries(id, user_id, exchange, month, total_fee, platform_commission, user_commission, trade_count, settlement_status, settlement_id)
collection_logs(id, exchange, started_at, finished_at, status, records_fetched, records_new, error_message)
withdrawals(id, account_id, amount, wallet_address, network, status, requested_at, processed_at, tx_hash, reject_reason, source_exchange, auto_sent, exchange_withdraw_id)
```

---

## 🔌 API 엔드포인트 전체 목록

```
=== 인증 ===
POST /api/auth/signup          회원가입
POST /api/auth/login           로그인
POST /api/auth/logout          로그아웃
GET  /api/auth/me              현재 유저

=== 마이페이지 ===
GET  /api/mypage/me            내 정보
GET  /api/mypage/profile       프로필 상세
GET  /api/mypage/uids          UID 목록
GET  /api/mypage/settlements   정산 내역
GET  /api/mypage/balance       잔고
GET  /api/mypage/withdrawals   출금 내역
POST /api/mypage/withdraw      출금 요청 ($50 최소)
GET  /api/mypage/commissions   커미션 내역 (페이지네이션)
GET  /api/mypage/commission-summary  월별 커미션 요약

=== 관리자 (Bearer 토큰 인증) ===
GET  /api/admin/stats          대시보드 통계
GET/POST/PATCH /api/admin/accounts     계정 관리
GET/POST/PUT/DELETE /api/admin/users   유저(UID) 관리
GET/POST/PUT/DELETE /api/admin/settlements  정산 관리
GET/POST/PUT/DELETE /api/admin/events  이벤트 관리
GET/POST/PUT/DELETE /api/admin/banners 배너 관리
GET/POST/PUT/DELETE /api/admin/notices 공지 관리
GET/POST /api/admin/exchange-configs   거래소 API 설정
POST /api/admin/exchange-configs/test  API 연결 테스트
GET  /api/admin/commissions    커미션 조회
GET  /api/admin/commission-summaries   커미션 요약
POST /api/admin/commission-summaries/:id/settle  정산 처리
GET  /api/admin/collection-logs        수집 로그
POST /api/admin/upload-commissions     CSV 업로드
POST /api/admin/collect-commissions    수동 커미션 수집
GET/PATCH /api/admin/withdrawals       출금 관리
POST /api/admin/withdrawals/:id/auto-send  자동 출금
POST /api/admin/crawl-events           이벤트 크롤링
POST /api/admin/seed-events            이벤트 시딩

=== 마켓 데이터 ===
GET  /api/binance/*            바이낸스 선물 API 프록시
GET  /api/market/all           통합 마켓 (듀얼소스: Bitget→Binance 폴백)
GET  /api/market/*             Bitget 마켓 프록시

=== 퍼블릭 ===
GET  /api/events               이벤트 목록
GET  /api/calendar             경제일정 (CoinMarketCal)
POST /api/register             UID 공개 등록
```

---

## 🔑 환경변수

```
ADMIN_USERNAME / ADMIN_PASSWORD   (기본: 1percentadmin / admin1234)
ENCRYPTION_KEY                     (AES-256-GCM, 기본: default_dev_key)
COINMARKETCAL_API_KEY             (선택사항)
DB                                 (D1 바인딩)
⚠️ .env 없음, wrangler secret으로 관리
```

---

## ✅ 완료된 기능

```
[완료] 유저 인증 시스템 (회원가입/로그인/세션/PBKDF2 해싱)
[완료] 관리자 대시보드 (유저/정산/이벤트/배너/공지 CRUD)
[완료] 커미션 자동 수집 (Bitget/OKX/Gate.io API 연동)
[완료] 커미션 정산 시스템 (월별 집계/정산 처리)
[완료] 출금 시스템 (요청→승인→자동 온체인 출금)
[완료] 이벤트 크롤링 (Bybit/Bitget/Gate.io/OKX/Binance)
[완료] 마켓 데이터 대시보드 (청산/펀딩비/롱숏/OI, 듀얼소스)
[완료] 김치프리미엄 계산
[완료] 다국어 (한/영/일/중)
[완료] UID 등록 + 거래소별 안내 페이지
[완료] 경제일정 (CoinMarketCal 연동)
[완료] 트레이딩 교육 페이지 (시장구조/ICT/캔들패턴)
```

---

## ⚠️ 미완료 / 알려진 이슈

```
[미구현] 매매일지 백엔드 (journal.html 프론트만 존재, API/DB 없음)
[미구현] WebSocket 실시간 스트리밍 (현재 30초 REST 폴링)
[미구현] 텔레그램 봇 연동
[미구현] SNS 마케팅 자동화
[미구현] 블로그 마케팅 자동화
[미구현] 트레이딩 매매봇
[미구현] CFD 데이터 통합
[미구현] 온체인 데이터
[이슈] Bitget API가 Cloudflare Workers에서 차단됨 (IP 제한)
[이슈] DB 스키마 v1↔v2 마이그레이션 스크립트 없음
[이슈] 기본 암호화 키가 코드에 하드코딩됨 (프로덕션 위험)
[이슈] CORS 전체 허용 상태
```

---

## 📊 Git 히스토리 요약 (최근 30커밋)

```
2026-03: i18n 일관성, 듀얼소스 마켓데이터, Bitget 전환, 언어버그 수정
2026-02: 로그인/회원가입 모달, 대시보드 업데이트, 관리자 회원목록
2026-01: UID등록, 메가드롭다운, D1 연동, 실시간 티커
2025-12: 회원관리, 실시간 시세, 인증시스템 구축
```

---

## 🔗 연동 거래소

```
Binance:  선물 API 프록시 (마켓데이터)
Bitget:   커미션 수집 + 마켓데이터 (듀얼소스 primary)
Gate.io:  커미션 수집
OKX:      커미션 수집
Bybit:    이벤트 크롤링
Bitunix:  이벤트 크롤링
```

---

## 🚀 배포 상태

```
플랫폼: Cloudflare Workers
이름: 1percentpro
D1 DB: 1percent-admin (ID: eeac24cb-a420-471f-babb-47ebb73daf30)
크론: 0 */6 * * * (커미션 수집 + 이벤트 크롤링)
현재 브랜치: master = 3f1aca0
마지막 배포: 확인 필요 (이전 버전 백업 존재: index_backup_before_rollback.html)
```

---
---
---

# 아래는 각 프로젝트(세션)별 컨텍스트 - 해당 세션에 복사해서 붙여넣기

---

# ═══════════════════════════════════════════
# 세션 1: 플랫폼 프로젝트정보
# ═══════════════════════════════════════════

```
[프로젝트명] 1% Trading PRO (1percentpro)
[역할] 이 세션은 플랫폼의 전체 구조와 상태를 기록/관리하는 허브 역할

[기술스택]
- 백엔드: Cloudflare Workers (worker.js, ~1,927줄)
- DB: Cloudflare D1 (SQLite)
- 프론트엔드: Vanilla HTML/CSS/JS (38개 HTML)
- 배포: wrangler deploy
- 크론: 6시간마다 커미션 수집 + 이벤트 크롤링

[현재 완료된 것]
✅ 유저 인증 (회원가입/로그인/세션)
✅ 관리자 대시보드 (CRUD 전체)
✅ 커미션 자동 수집 + 정산 (Bitget/OKX/Gate.io)
✅ 출금 시스템 (자동 온체인 출금)
✅ 이벤트 크롤링 (5개 거래소)
✅ 마켓 데이터 대시보드 (듀얼소스)
✅ 김치프리미엄
✅ 다국어 (한/영/일/중)
✅ 트레이딩 교육 페이지

[미완료]
❌ 매매일지 백엔드 (프론트만 있음)
❌ WebSocket 실시간
❌ 텔레그램 봇
❌ SNS/블로그 마케팅 자동화
❌ 트레이딩 매매봇
❌ CFD 데이터
❌ 온체인 데이터

[알려진 이슈]
⚠️ Bitget API → Cloudflare Workers 차단
⚠️ DB 스키마 v1↔v2 마이그레이션 미완
⚠️ 기본 암호화 키 하드코딩

[API 전체 목록은 위의 종합 섹션 참조]

[한 사이클 구조]
플랫폼개발 → 봇/자동화 → 마케팅/SNS → 트레이딩 → 매매일지자동화 → SNS자동화 → (루프)

[목표]
CoinGlass/CoinGecko/CoinMarketCap 수준 종합 플랫폼
+ 리퍼럴 페이백 + 매매일지 + 커뮤니티
```

---

# ═══════════════════════════════════════════
# 세션 1.1: 플랫폼 개발
# ═══════════════════════════════════════════

```
[프로젝트명] 1% Trading PRO - 플랫폼 개발
[역할] 코드 작성, 버그 수정, 기능 추가, 배포

[기술스택]
- Cloudflare Workers + D1 (worker.js ~1,927줄)
- Vanilla HTML/CSS/JS (38개 HTML)
- wrangler deploy

[소스 구조]
- worker.js: 전체 백엔드 API (인증/관리자/커미션/마켓데이터/출금)
- schema.sql + schema_v2.sql: DB 스키마
- wrangler.toml: 배포 설정
- 38개 HTML: 각 페이지 프론트엔드

[핵심 API]
인증: /api/auth/signup, login, logout, me
마이페이지: /api/mypage/profile, uids, balance, withdraw, commissions
관리자: /api/admin/stats, accounts, users, settlements, events, banners, notices
커미션: /api/admin/collect-commissions, upload-commissions, commission-summaries
출금: /api/admin/withdrawals, auto-send
마켓: /api/binance/*, /api/market/all
퍼블릭: /api/events, /api/calendar, /api/register

[DB 테이블]
accounts, sessions, users, settlements, events, banners, notices
exchange_api_configs, commissions, commission_summaries, collection_logs, withdrawals

[현재 작업 상태]
- master 브랜치 = 최신 (3f1aca0)
- 마지막 커밋: 거래소 이벤트 배너 + i18n 일관성 (2026-03-06)
- 미배포 변경사항: 확인 필요

[다음 해야 할 것]
1. 매매일지 백엔드 구현 (journal.html에 맞는 API + DB)
2. DB 스키마 마이그레이션 정리
3. Bitget API 차단 우회
4. 기본 암호화 키 → production secret으로
5. CORS 정책 강화

[배포 규칙]
⚠️ 배포 전 반드시 사용자 승인 필요
⚠️ 현재 배포 버전과 비교 후 배포
⚠️ 이전 버전 백업 유지
```

---

# ═══════════════════════════════════════════
# 세션 2: 봇/자동화
# ═══════════════════════════════════════════

```
[프로젝트명] 1% Trading PRO - 봇/자동화
[역할] 텔레그램 봇, 커뮤니티 봇, 알림 자동화

[플랫폼 연동 정보]
- 백엔드: Cloudflare Workers (worker.js)
- DB: Cloudflare D1
- 마켓 데이터 API: /api/market/all (BTC/ETH/SOL 펀딩비, OI, 롱숏비율)
- 바이낸스 프록시: /api/binance/* (선물 API 전체)

[현재 상태: 미구현]
이 영역은 아직 개발 시작 전입니다.

[계획된 기능]
1. 텔레그램 트레이딩 봇
   - 자동 거래체결 알림 (체결창 스크린샷)
   - 엔트리/타겟/TP 자동 안내
   - 결과 리포트 ("오늘도 수고했습니다")
   - AI 스타일 자동 대화

2. 플랫폼 전용 커뮤니티 봇
   - CoinGlass/CoinGecko 스타일 실시간 데이터 알림
   - OI, 롱숏비율, 가격 변동, RSI 시간대별
   - 상승/하락 %, 폭락 감지
   - 문의 접수 자동화

3. 안내 자동화
   - 플랫폼 기능 안내
   - 선물 데이터 연동 알림
   - 신규 가입자 온보딩

[참고: 플랫폼에서 가져올 수 있는 데이터]
- /api/market/all → 펀딩비, 24h 티커, OI, 롱숏비율 (BTC/ETH/SOL)
- /api/binance/fapi/v1/* → 바이낸스 선물 전체
- /api/events → 거래소 이벤트
- /api/calendar → 경제 일정

[텔레그램 봇 구독자 성장이 최우선 목표]
- 트레이딩 시그널 채널 → 구독자 확보 → 플랫폼 유입
```

---

# ═══════════════════════════════════════════
# 세션 3: 마케팅/SNS
# ═══════════════════════════════════════════

```
[프로젝트명] 1% Trading PRO - 마케팅/SNS
[역할] 플랫폼 마케팅 전략, SNS 자동화, 블로그 마케팅

[현재 상태: 미구현]
이 영역은 아직 개발 시작 전입니다.

[플랫폼 현황]
- 암호화폐 선물거래 리퍼럴/커미션 관리 플랫폼
- 연동 거래소: Binance, Bitget, Gate.io, OKX
- 차별점: 리퍼럴 페이백 + 실시간 데이터 + 매매일지 + 교육
- 다국어: 한/영/일/중

[마케팅 전략 수립 필요]
1. 타겟 설정
   - 암호화폐 선물 트레이더
   - 리퍼럴 페이백에 관심있는 유저
   - 매매일지가 필요한 트레이더

2. 채널 전략
   - 블로그 마케팅 자동화 (돈 안 쓰고 홍보)
   - SNS 자동화 (시간 지날수록 자료 축적 → 노출 증가)
   - 텔레그램 채널 (트레이딩 시그널 → 구독자 → 플랫폼 유입)

3. 콘텐츠 전략
   - 트레이딩 교육 콘텐츠 (이미 사이트에 있음)
   - 거래소 이벤트/혜택 정보
   - 실시간 마켓 데이터 요약
   - 매매일지 활용법

[핵심 원칙]
- 돈 안 쓰고 자동화로 홍보
- 시간이 지날수록 자료가 쌓여서 노출 증가
- 한 사이클 완성 후 본격 마케팅
```

---

# ═══════════════════════════════════════════
# 세션 4: 트레이딩
# ═══════════════════════════════════════════

```
[프로젝트명] 1% Trading PRO - 트레이딩
[역할] 트레이딩 전략, 시그널, 데이터 분석, 매매봇

[플랫폼에 이미 있는 트레이딩 관련 기능]
✅ 마켓 데이터 대시보드 (듀얼소스: Bitget→Binance)
   - 펀딩비 (BTC/ETH/SOL)
   - 24h 티커 (가격, 변동률, 거래량)
   - 미결제약정 (OI)
   - 롱숏비율
✅ 청산 데이터 페이지 (/contract/liquidation.html)
✅ 펀딩비 페이지 (/contract/funding.html)
✅ 롱숏비율 페이지 (/contract/longshort.html)
✅ OI 페이지 (/contract/oi.html)
✅ 김치프리미엄 (kimp.html)
✅ 경제 일정 (CoinMarketCal 연동)
✅ 트레이딩 교육 (시장구조/ICT/캔들패턴)

[미구현 - 계획]
❌ 트레이딩 매매봇 (Bitget API 연동)
❌ 자동 체결 알림 (텔레그램)
❌ RSI 시간대별 데이터
❌ 시간대별 변동률 분석
❌ WebSocket 실시간 스트리밍

[사용 가능한 API]
- /api/market/all → 통합 마켓 데이터
- /api/binance/fapi/v1/* → 바이낸스 선물 전체
- Bitget/OKX/Gate.io API 키 → exchange_api_configs 테이블에 암호화 저장

[목표]
- CoinGlass 수준의 데이터 대시보드
- 트레이딩 시그널 채널 운영
- 매매봇 개발 (Bitget)
```

---

# ═══════════════════════════════════════════
# 세션 5: 매매일지 자동화
# ═══════════════════════════════════════════

```
[프로젝트명] 1% Trading PRO - 매매일지 자동화
[역할] 매매일지 기능 개발 및 자동화

[현재 상태: 프론트엔드만 존재]
- journal.html 파일 있음
- 백엔드 API 없음
- DB 테이블 없음
- 거래소 API 연동으로 자동 기록 없음

[플랫폼 기술스택]
- Cloudflare Workers + D1 (worker.js에 API 추가 필요)
- 사용 가능한 거래소 API: Bitget, OKX, Gate.io (키 암호화 저장됨)

[구현 필요한 것]
1. DB 테이블 설계
   - journal_entries: 매매 기록 (종목, 방향, 진입가, 청산가, 수량, 손익, 수수료 등)
   - journal_tags: 매매 태그/카테고리
   - journal_notes: 매매 메모/복기

2. 백엔드 API (worker.js에 추가)
   - CRUD: 매매일지 등록/조회/수정/삭제
   - 통계: 일별/주별/월별 수익률, 승률
   - 자동 수집: 거래소 API에서 체결 내역 가져오기

3. 프론트엔드 개선
   - journal.html 기존 UI에 맞춰 API 연동
   - 차트/통계 시각화

4. 자동화
   - 거래소에서 체결 내역 자동 수집
   - 크론 또는 실시간 동기화

[핵심 가치]
- 트레이더들이 매매일지를 귀찮아서 안 씀
- 자동화하면 이걸로만 유저 유입 가능
- 노션보다 가볍고 빠르게
```

---

# ═══════════════════════════════════════════
# 세션 6: SNS 자동화 또는 1% Trading
# ═══════════════════════════════════════════

```
[프로젝트명] 1% Trading PRO - SNS 자동화
[역할] SNS 콘텐츠 자동 생성 및 포스팅

[현재 상태: 미구현]
이 영역은 아직 개발 시작 전입니다.

[계획]
1. 블로그 자동 포스팅
   - 트레이딩 교육 콘텐츠 자동 생성
   - 마켓 데이터 요약 자동 포스팅
   - 거래소 이벤트 소식 자동 공유
   - SEO 최적화

2. SNS 자동 포스팅
   - 트위터/X 자동 포스팅
   - 인스타그램 자동 포스팅
   - 마켓 데이터 카드 이미지 자동 생성

3. 콘텐츠 소스 (플랫폼에서 가져올 수 있는 것)
   - /api/market/all → 실시간 마켓 데이터
   - /api/events → 거래소 이벤트
   - /api/calendar → 경제 일정
   - 트레이딩 교육 페이지 콘텐츠

[핵심 원칙]
- 시간이 지날수록 자료가 쌓임
- 쌓일수록 노출 증가
- 없는 것보다 나음 → 무조건 자동화 세팅
```

---

# 경쟁 벤치마크

```
우리가 이겨야 할 7개:
1. CoinGlass     - 선물 데이터 (OI, 펀딩비, 청산)
2. CoinGecko     - 코인 정보/가격
3. CoinMarketCap - 시총/가격/뉴스
4. CoinAnk       - 선물 데이터
5. CoinMarketCal - 이벤트/일정
6. Investing.com - 경제지표/뉴스 (CFD 포함)
7. DefiLlama    - 온체인 데이터

우리의 차별점: 위 7개 기능 통합 + 리퍼럴 페이백 + 매매일지 + 커뮤니티
```
