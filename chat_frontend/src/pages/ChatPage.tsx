import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import { useChatStore } from '../stores/chatStore';
import ConversationList from '../components/chat/ConversationList';
import ChatWindow from '../components/chat/ChatWindow';

export default function ChatPage() {
  const { token } = useAuthStore();
  const { connectUserWs, disconnectUserWs } = useChatStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!token) { navigate('/login'); return; }
    connectUserWs(token);
    return () => disconnectUserWs();
  }, [token]);

  return (
    <div className="h-screen flex overflow-hidden">
      <ConversationList />
      <ChatWindow />
    </div>
  );
}
