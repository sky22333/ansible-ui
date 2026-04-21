import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';
import { Button } from '@/components/ui/button';
import { ReloadIcon, CheckCircledIcon, CrossCircledIcon } from '@radix-ui/react-icons';
import { toast } from "sonner";
import { authStorage } from '@/contexts/auth-storage';
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/http';

interface ResizeData {
  cols: number;
  rows: number;
}

function TerminalPage() {
  const { hostId } = useParams<{ hostId: string }>();
  const navigate = useNavigate();
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [wsToken, setWsToken] = useState<string | null>(null);

  const sendResize = useCallback(() => {
    if (socket.current?.readyState === WebSocket.OPEN && term.current) {
      const dimensions: ResizeData = {
        cols: term.current.cols,
        rows: term.current.rows,
      };
      socket.current.send(JSON.stringify({
        type: 'resize',
        data: dimensions,
      }));
    }
  }, []);

  const fetchWsToken = useCallback(async () => {
    try {
      if (!hostId) {
        toast.error("错误", { description: "无效的主机ID" });
        return;
      }

      const response = await api.get<{ token: string }>(`/api/ws-token/${hostId}`);
      setWsToken(response.data.token);
    } catch (error: unknown) {
      toast.error("认证错误", {
        description: getApiErrorMessage(error, "无法获取终端连接授权"),
      });

      if (isAxiosError(error) && error.response?.status === 401) {
        navigate('/login', { replace: true });
      }
    }
  }, [hostId, navigate]);

  const connectWebSocket = useCallback((token?: string) => {
    const currentToken = token || wsToken;

    if (!hostId || !currentToken) {
      toast.error("错误", { description: currentToken ? "无效的主机ID" : "未获取到连接授权" });
      setIsConnecting(false);
      return;
    }

    if (socket.current && socket.current.readyState !== WebSocket.CLOSED) {
      socket.current.close();
    }

    setIsConnecting(true);
    setIsConnected(false);
    term.current?.clear();
    term.current?.write('正在连接 WebSocket...\r\n');

    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws/terminal/${hostId}?token=${encodeURIComponent(currentToken)}`;
      socket.current = new WebSocket(wsUrl);

      socket.current.onopen = () => {
        setIsConnected(true);
        setIsConnecting(false);
        term.current?.write('\r\n\x1b[1;32m 正在连接主机终端 \x1b[0m\r\n');
        fitAddon.current?.fit();
        sendResize();
        term.current?.focus();
      };

      socket.current.onmessage = (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          if (data.error) {
            term.current?.write(`\r\n\x1b[1;31m*** 错误: ${data.error} ***\x1b[0m\r\n`);
            return;
          }
        } catch {
          term.current?.write(event.data);
        }
      };

      socket.current.onclose = (event) => {
        setIsConnected(false);
        setIsConnecting(false);
        term.current?.write('\r\n\x1b[1;31m*** 连接已断开 ***\x1b[0m\r\n');

        if (event.code === 1008) {
          void fetchWsToken();
        }
      };

      socket.current.onerror = () => {
        setIsConnected(false);
        setIsConnecting(false);
        term.current?.write('\r\n\x1b[1;31m*** 连接错误 ***\x1b[0m\r\n');
        toast.error("WebSocket 错误", { description: "无法连接到终端服务" });
      };
    } catch {
      setIsConnecting(false);
      term.current?.write('\r\n\x1b[1;31m*** WebSocket 创建失败 ***\x1b[0m\r\n');
      toast.error("连接失败", { description: "无法创建 WebSocket 连接" });
    }
  }, [fetchWsToken, hostId, sendResize, wsToken]);
  
  useEffect(() => {
    const isAuthenticated = authStorage.getAuth();
    const hasToken = !!authStorage.getToken();
    
    if (!isAuthenticated || !hasToken) {
      toast.error("需要登录", { description: "请先登录系统才能使用终端功能" });
      navigate('/login', { replace: true });
      return;
    }
    
    void fetchWsToken();
    
    return () => {
      if (socket.current) {
        socket.current.close();
      }
      if (term.current) {
        term.current.dispose();
      }
    };
  }, [fetchWsToken, navigate]);

  useEffect(() => {
    if (!terminalRef.current || term.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      allowTransparency: false,
      scrollback: 5000,
    });

    fitAddon.current = new FitAddon();
    terminal.loadAddon(fitAddon.current);

    term.current = terminal;
    terminal.open(terminalRef.current);

    terminal.onKey(({ key, domEvent }) => {
      if (domEvent.ctrlKey && domEvent.key === 'c') {
        if (socket.current?.readyState === WebSocket.OPEN) {
          socket.current.send(JSON.stringify({ type: 'input', data: '\x03' }));
        }
      } else {
        if (socket.current?.readyState === WebSocket.OPEN) {
          socket.current.send(JSON.stringify({ type: 'input', data: key }));
        }
      }
    });

    terminal.onData((data) => {
      if (socket.current?.readyState === WebSocket.OPEN) {
        if (data.length > 1) {
          socket.current.send(JSON.stringify({ type: 'input', data }));
        }
      }
    });

    terminal.onResize(() => {
      sendResize();
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.current?.fit();
    });

    if (terminalRef.current?.parentElement) {
      resizeObserver.observe(terminalRef.current.parentElement);
    }

    const handleWindowResize = () => fitAddon.current?.fit();
    window.addEventListener('resize', handleWindowResize);

    fitAddon.current.fit();

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [sendResize]);

  useEffect(() => {
    if (wsToken && term.current) {
      connectWebSocket(wsToken);
    }
  }, [connectWebSocket, wsToken]);

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="p-2 border-b flex items-center justify-between bg-card text-card-foreground">
        <h1 className="text-lg font-semibold">终端 - 主机 ID: {hostId}</h1>
        <div className="flex items-center gap-2">
          <span className={`flex items-center gap-1 text-sm ${isConnected ? 'text-green-500' : 'text-red-500'}`}>
            {isConnecting ? (
              <ReloadIcon className="h-4 w-4 animate-spin" />
            ) : isConnected ? (
              <CheckCircledIcon className="h-4 w-4" />
            ) : (
              <CrossCircledIcon className="h-4 w-4" />
            )}
            {isConnecting ? '连接中' : isConnected ? '已连接' : '已断开'}
          </span>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => connectWebSocket()} 
            disabled={isConnecting}
          >
            <ReloadIcon className="mr-1 h-4 w-4" />
            重新连接
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => term.current?.clear()}
          >
            清屏
          </Button>
        </div>
      </header>
      <div ref={terminalRef} className="flex-grow p-1 w-full h-full overflow-hidden"></div>
    </div>
  );
}

export default TerminalPage;

