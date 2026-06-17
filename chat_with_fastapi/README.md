Tạo chat 1-1:

Tạo Conversation(type=DIRECT)
Thêm 2 record vào ConversationMember
Khi gửi tin nhắn, insert Message
Tạo group:

Tạo Conversation(type=GROUP, name=...)
Người tạo là OWNER
Các user còn lại là MEMBER
Seen message:

Khi user mở conversation, update ConversationMember.last_read_message_id
Nếu cần log chi tiết, insert/update MessageRead
Gửi ảnh/video:

Upload file lên storage
Tạo Message(type=IMAGE/VIDEO/MIXED)
Tạo các record MessageAttachment