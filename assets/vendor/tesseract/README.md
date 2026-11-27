# Tesseract OCR (자체 호스팅)

관리자 패널 › AI 추천 정보 › "이미지로 새 숙소·새 골프장 등록"에서 이미지의 글자를 읽는 데 쓰는 파일입니다.
이미지는 브라우저 안에서만 처리되며 서버로 전송되지 않습니다. 이 기능을 쓸 때만 불러옵니다(홈페이지 첫 화면 속도와 무관).

- `tesseract.min.js`, `worker.min.js` — tesseract.js 5.1.1 (Apache-2.0)
- `tesseract-core-simd-lstm.wasm.js`, `tesseract-core-lstm.wasm.js` — tesseract.js-core 5.1.1 (Apache-2.0)
- `lang/kor.traineddata.gz`, `lang/eng.traineddata.gz` — tessdata_best (integer) 한국어·영어 데이터 (Apache-2.0)
