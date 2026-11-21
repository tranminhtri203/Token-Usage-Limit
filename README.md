# han-muc

Mod cho Claude Code: thanh hạn mức sử dụng (phiên 5 giờ, tuần 7 ngày) hiển thị phía trên ô nhập.
Thanh 10 ô màu (xanh → vàng → đỏ theo mức đã dùng, ô xám là phần còn lại),
ghi thời gian còn lại đến lúc làm mới và nhịp dùng (trong nhịp / đúng nhịp / nhanh hơn nhịp).
Có khung "Hạn mức sử dụng" cạnh khung chat (tự mở) và lệnh `/han-muc` in bảng hạn mức dạng chữ.
Cảnh báo một lần khi một khung vượt 90%. Số liệu chỉ có với gói thuê bao Claude (Pro/Max).

Lệnh: `/han-muc` chuyển vòng đầy đủ → gọn → ẩn; hoặc `/han-muc day`, `/han-muc gon`, `/han-muc an`.

Bảng hạn mức in cuối mỗi câu trả lời (bật/tắt: `/han-muc cuoi`), và ghi ra file `D:\2025\OneDrive\2.Cá nhân\Github\Han-muc\han-muc.json`
(đổi trong cấu hình plugin, mục `outFile`) để skill ở Cowork đọc.

## Cài đặt

Tại ô nhập của Claude Code trên terminal:

```
/plugin install han-muc --marketplace tranminhtri203/token-usage-limit
```

Chọn `y` để thêm marketplace, rồi chọn phạm vi (user).

Từ shell:

```bash
claude plugin install han-muc --marketplace tranminhtri203/token-usage-limit
```

Trong ứng dụng desktop: bấm + cạnh ô nhập → Plugins → Add marketplace với `tranminhtri203/token-usage-limit` → Add plugin.

Repo riêng tư: máy cài phải có quyền đọc repo và đã có git credential cho github.com
(`gh auth login` rồi `gh auth setup-git`).
