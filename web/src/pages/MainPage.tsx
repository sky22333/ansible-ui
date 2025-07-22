import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger, DialogClose } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import api from '@/services/api';
import { PlusCircledIcon, Pencil1Icon, TrashIcon, CheckCircledIcon, CrossCircledIcon, PlayIcon, UploadIcon, ReaderIcon, ReloadIcon, InfoCircledIcon } from '@radix-ui/react-icons';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger, SheetFooter, SheetClose } from "@/components/ui/sheet";
import FileUpload from '@/components/FileUpload';
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth, authStorage } from '@/contexts/AuthContext';
import { TerminalIcon, Github } from 'lucide-react';
import PlaybookExecutor from '@/components/PlaybookExecutor';
import { prepareHostData } from '@/utils/crypto';
import { Switch } from "@/components/ui/switch";

// Define Host type based on backend API
interface Host {
  id: number;
  comment: string;
  address: string;
  username: string;
  port: number;
  password?: string;
  status?: 'checking' | 'success' | 'unreachable' | 'failed' | null;
  is_password_encrypted?: boolean;
  auth_method?: 'password' | 'key';
}

// Define Access Log type
interface AccessLog {
  id: number;
  access_time: string;
  ip_address: string;
  path: string;
  status_code: number;
}

function MainPage() {
  const [hosts, setHosts] = useState<Host[]>([]);
  const [selectedHostIds, setSelectedHostIds] = useState<number[]>([]);
  const [command, setCommand] = useState('');
  const [commandLogs, setCommandLogs] = useState<string[]>([]);
  const [isLoadingHosts, setIsLoadingHosts] = useState(false);
  const [isExecutingCommand, setIsExecutingCommand] = useState(false);
  const [isAddingHost, setIsAddingHost] = useState(false);
  const [isEditingHost, setIsEditingHost] = useState(false);
  const [editingHost, setEditingHost] = useState<Host | null>(null);
  const [batchInput, setBatchInput] = useState('');
  const [accessLogs, setAccessLogs] = useState<AccessLog[]>([]);
  const [isLoadingAccessLogs, setIsLoadingAccessLogs] = useState(false);
  const [accessLogIpFilter, setAccessLogIpFilter] = useState('');
  const [accessLogPathFilter, setAccessLogPathFilter] = useState('');
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadTarget, setUploadTarget] = useState<'selected' | 'all' | null>(null);
  const [isBatchAddOpen, setIsBatchAddOpen] = useState(false); // Control batch add dialog
  const [isAuthChecking, setIsAuthChecking] = useState(true); // 新增：认证检查状态
  const [isPlaybookDialogOpen, setIsPlaybookDialogOpen] = useState(false);
  const [playbookTarget, setPlaybookTarget] = useState<'selected' | 'all' | null>(null);
  const [useKeyAuth, setUseKeyAuth] = useState(() => {
    const saved = localStorage.getItem('useKeyAuth');
    return saved ? JSON.parse(saved) : false;
  });

  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  // 改进后的认证状态检查逻辑
  useEffect(() => {
    const checkAuth = () => {
      try {
        const isLocalAuth = authStorage.getAuth();

        // 如果既没有React context认证也没有localStorage认证，则跳转到登录页
        if (!isAuthenticated && !isLocalAuth) {
          navigate('/login');
          return false;
        }
        return true;
      } catch (error) {
        return false;
      }
    };

    // 立即检查认证状态
    const isAuthed = checkAuth();

    // 只有通过了认证检查，才执行后续的数据加载
    if (isAuthed) {
      fetchHosts();
    }

    // 完成认证检查
    setIsAuthChecking(false);
  }, [isAuthenticated, navigate]);

  useEffect(() => {
    fetchHosts();
  }, []);

  // 持久化密钥认证开关状态
  useEffect(() => {
    localStorage.setItem('useKeyAuth', JSON.stringify(useKeyAuth));
  }, [useKeyAuth]);

  const fetchHosts = async () => {
    setIsLoadingHosts(true);
    try {
      const response = await api.get<Host[]>('/api/hosts');
      const hostsWithStatus = response.data.map(host => ({ ...host, status: null }));
      setHosts(hostsWithStatus);
    } catch (error) {
      console.error('Failed to fetch hosts:', error);
      toast.error("获取主机列表失败", {
        description: error instanceof Error ? error.message : "无法连接到服务器",
      });
    } finally {
      setIsLoadingHosts(false);
    }
  };

  const fetchAccessLogs = async (ipFilter = '', pathFilter = '') => {
    setIsLoadingAccessLogs(true);
    try {
      const response = await api.get<AccessLog[]>('/api/access-logs', {
        params: { ip: ipFilter, path: pathFilter }
      });
      setAccessLogs(response.data);
    } catch (error) {
      console.error('Failed to fetch access logs:', error);
      toast.error("获取访问日志失败", {
        description: error instanceof Error ? error.message : "无法连接到服务器",
      });
    } finally {
      setIsLoadingAccessLogs(false);
    }
  };

  const handleAddHosts = async () => {
    if (!batchInput.trim()) {
      toast.error("错误", { description: "请输入主机信息" });
      return;
    }
    const lines = batchInput.trim().split('\n');
    const hostsData: Omit<Host, 'id'>[] = [];
    const errors: string[] = [];
    const expectedParts = useKeyAuth ? 4 : 5;
    const formatString = useKeyAuth ? "'备注 地址 用户名 端口'" : "'备注 地址 用户名 端口 密码'";

    lines.forEach((line, index) => {
      if (line.trim() === '') return;
      const parts = line.trim().split(/\s+/);
      if (parts.length !== expectedParts) {
        errors.push(`第${index + 1}行：格式错误，应为 ${formatString}`);
      } else {
        const [comment, address, username, portStr, password] = parts;
        const port = parseInt(portStr, 10);
        if (isNaN(port)) {
          errors.push(`第${index + 1}行：端口号 '${portStr}' 无效`);
        } else {
          hostsData.push({
            comment,
            address,
            username,
            port,
            password: useKeyAuth ? '' : password
          });
        }
      }
    });
    if (errors.length > 0) {
      errors.forEach(err => toast.error("输入错误", { description: err }));
      return;
    }
    if (hostsData.length === 0) {
      toast.error("错误", { description: "未找到有效的主机信息" });
      return;
    }
    setIsAddingHost(true);
    try {
      // 对每个主机数据进行处理
      const processedHostsData = hostsData.map(host => prepareHostData(host, undefined, useKeyAuth));
      const response = await api.post('/api/hosts/batch', processedHostsData);
      toast.success("成功", { description: response.data.message || `成功添加 ${response.data.count} 台主机` });
      setBatchInput('');
      fetchHosts();
      setIsBatchAddOpen(false); // Close dialog on success
    } catch (error) {
      console.error('Failed to add hosts:', error);
      toast.error("添加主机失败", {
        description: error instanceof Error ? error.message : (error as any).response?.data?.error || "发生未知错误",
      });
    } finally {
      setIsAddingHost(false);
    }
  };

  const handleEditHost = (host: Host) => {
    // 确保编辑时有默认的认证方式
    const hostWithDefaults = {
      ...host,
      auth_method: host.auth_method || 'password'
    };
    setEditingHost(hostWithDefaults);
  };

  const handleSaveEdit = async (editedHost: Host) => {
    if (!editingHost) return;
    setIsEditingHost(true);
    try {
      // 处理主机数据，特别是密码字段
      const dataToSend = prepareHostData(editedHost, editingHost, editedHost.auth_method === 'key');

      await api.put(`/api/hosts/${editingHost.id}`, dataToSend);
      toast.success("成功", { description: "主机信息已更新" });
      setEditingHost(null);
      fetchHosts();
    } catch (error) {
      console.error('Failed to update host:', error);
      toast.error("更新主机失败", {
        description: error instanceof Error ? error.message : (error as any).response?.data?.error || "发生未知错误",
      });
    } finally {
      setIsEditingHost(false);
    }
  };

  const handleDeleteHost = async (hostId: number) => {
    if (!confirm(`确定要删除主机 ID: ${hostId} 吗？`)) return;
    try {
      await api.delete(`/api/hosts/${hostId}`);
      toast.success("成功", { description: `主机 ID: ${hostId} 已删除` });
      fetchHosts();
    } catch (error) {
      console.error('Failed to delete host:', error);
      toast.error("删除主机失败", {
        description: error instanceof Error ? error.message : (error as any).response?.data?.error || "发生未知错误",
      });
    }
  };

  const handlePingHost = async (hostId: number) => {
    setHosts(prevHosts => prevHosts.map(h => h.id === hostId ? { ...h, status: 'checking' } : h));
    try {
      const response = await api.get(`/api/hosts/${hostId}/ping`);
      setHosts(prevHosts => prevHosts.map(h => h.id === hostId ? { ...h, status: response.data.status } : h));
      if (response.data.status === 'success') {
        toast.success(`Ping 主机 ${hostId}`, { description: response.data.message });
      } else {
        toast.warning(`Ping 主机 ${hostId}`, { description: response.data.message });
      }
    } catch (error) {
      console.error(`Failed to ping host ${hostId}:`, error);
      setHosts(prevHosts => prevHosts.map(h => h.id === hostId ? { ...h, status: 'failed' } : h));
      toast.error(`Ping 主机 ${hostId} 失败`, {
        description: error instanceof Error ? error.message : "检查失败",
      });
    }
  };

  const handlePingAllHosts = () => {
    hosts.forEach(host => handlePingHost(host.id));
  };

  const handleExecuteCommand = async (target: 'selected' | 'all') => {
    if (!command.trim()) {
      toast.error("错误", { description: "请输入要执行的命令" });
      return;
    }
    let targetHostIds: number[] | 'all';
    if (target === 'selected') {
      if (selectedHostIds.length === 0) {
        toast.error("错误", { description: "请在下方表格中选择目标主机" });
        return;
      }
      targetHostIds = selectedHostIds;
    } else {
      targetHostIds = 'all';
    }
    setIsExecutingCommand(true);
    addLog(`[${new Date().toLocaleTimeString()}] 执行命令 '${command}' 于 ${target === 'all' ? '所有主机' : '主机 ' + (Array.isArray(targetHostIds) ? targetHostIds.join(', ') : '')}...`);
    try {
      const response = await api.post('/api/execute', { command: command, hosts: targetHostIds });
      addLog(`[${new Date().toLocaleTimeString()}] 命令执行结果:\n${JSON.stringify(response.data, null, 2)}`);
      toast.success("命令执行成功");
    } catch (error) {
      console.error('Command execution failed:', error);
      const errorMsg = error instanceof Error ? error.message : (error as any).response?.data?.error || "发生未知错误";
      addLog(`[${new Date().toLocaleTimeString()}] 命令执行失败: ${errorMsg}`);
      toast.error("命令执行失败", { description: errorMsg });
    } finally {
      setIsExecutingCommand(false);
    }
  };

  const addLog = (message: string) => {
    setCommandLogs(prevLogs => [...prevLogs.slice(-100), message]);
  };

  const handleSelectAllHosts = (checked: boolean | 'indeterminate') => {
    if (checked === true) {
      setSelectedHostIds(hosts.map(h => h.id));
    }
    else {
      setSelectedHostIds([]);
    }
  };

  const handleHostSelectionChange = (hostId: number, checked: boolean) => {
    setSelectedHostIds(prev =>
      checked ? [...prev, hostId] : prev.filter(id => id !== hostId)
    );
  };

  const openTerminal = (hostId: number) => {
    // 打开新窗口
    const terminalWindow = window.open(`/terminal/${hostId}`, `terminal_${hostId}`, 'width=800,height=600');

    // 确保新窗口成功打开
    if (!terminalWindow) {
      toast.error('无法打开终端', { description: '请允许浏览器打开弹出窗口' });
      return;
    }

    // 等待新窗口加载完成
    const sendAuthInfo = () => {
      try {
        // 获取认证令牌
        const token = authStorage.getToken();
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 5); // 5小时过期时间

        // 如果terminalWindow可用且已加载完成，发送认证信息
        if (terminalWindow && terminalWindow.document.readyState === 'complete') {
          localStorage.setItem('isAuthenticated', 'true');
          localStorage.setItem('authExpiresAt', expiresAt.toISOString());
          if (token) {
            localStorage.setItem('token', token);
          }

          // 尝试向新窗口发送消息，以便它可以检测认证状态
          terminalWindow.postMessage({
            type: 'AUTH_INFO',
            isAuthenticated: true,
            authExpiresAt: expiresAt.toISOString(),
            token: token
          }, '*');

          // 移除敏感日志
        } else {
          // 如果窗口未完成加载，稍后再试
          setTimeout(sendAuthInfo, 500);
        }
      } catch (e) {
        // 移除敏感日志
        toast.error('无法连接到终端', { description: '认证信息传递失败' });
      }
    };

    // 开始尝试发送认证信息
    setTimeout(sendAuthInfo, 500);
  };

  const openUploadDialog = (target: 'selected' | 'all') => {
    if (target === 'selected' && selectedHostIds.length === 0) {
      toast.error("错误", { description: "请选择要上传文件的主机" });
      return;
    }
    if (target === 'all' && hosts.length === 0) {
      toast.error("错误", { description: "没有主机可供上传" });
      return;
    }
    setUploadTarget(target);
    setIsUploadDialogOpen(true);
  };

  const handleUploadComplete = () => {
    console.log("Upload complete callback triggered");
  };

  const handleCleanupAccessLogs = async () => {
    if (!confirm('确定要清理7天前的访问日志吗？')) return;
    try {
      const response = await api.post('/api/access-logs/cleanup');
      toast.success("成功", { description: response.data.message });
      fetchAccessLogs(accessLogIpFilter, accessLogPathFilter);
    } catch (error) {
      console.error('Failed to cleanup access logs:', error);
      toast.error("清理日志失败", {
        description: error instanceof Error ? error.message : "发生未知错误",
      });
    }
  };

  const openPlaybookDialog = (target: 'selected' | 'all') => {
    if (target === 'selected' && selectedHostIds.length === 0) {
      toast.error("错误", { description: "请选择要执行任务的主机" });
      return;
    }
    if (target === 'all' && hosts.length === 0) {
      toast.error("错误", { description: "没有主机可供执行任务" });
      return;
    }
    setPlaybookTarget(target);
    setIsPlaybookDialogOpen(true);
  };

  const handlePlaybookComplete = () => {
    console.log("Playbook execution complete");
  };

  const isAllSelected = hosts.length > 0 && selectedHostIds.length === hosts.length;
  const isIndeterminate = selectedHostIds.length > 0 && selectedHostIds.length < hosts.length;

  // 添加加载指示器
  if (isAuthChecking) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex flex-col items-center gap-2">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
          <p className="text-sm text-muted-foreground">验证登录状态...</p>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="container mx-auto p-4 md:p-6 lg:p-8 space-y-6">
        <header className="flex flex-col sm:flex-row justify-between items-center gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold">Ansible 面板</h1>
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" onClick={() => fetchAccessLogs()}> <ReaderIcon className="mr-2 h-4 w-4" /> 访问日志</Button>
            </SheetTrigger>
            <SheetContent className="w-full sm:max-w-3xl">
              <SheetHeader>
                <SheetTitle>系统访问日志</SheetTitle>
                <SheetDescription>查看最近的系统访问记录。</SheetDescription>
              </SheetHeader>
              <div className="grid gap-4 py-4">
                <div className="flex flex-col sm:flex-row gap-2 items-center">
                  <Input
                    placeholder="搜索 IP 地址"
                    value={accessLogIpFilter}
                    onChange={(e) => setAccessLogIpFilter(e.target.value)}
                    className="flex-1"
                  />
                  <Input
                    placeholder="搜索路径"
                    value={accessLogPathFilter}
                    onChange={(e) => setAccessLogPathFilter(e.target.value)}
                    className="flex-1"
                  />
                  <div className="flex gap-2 w-full sm:w-auto">
                    <Button className="flex-1 sm:flex-none" onClick={() => fetchAccessLogs(accessLogIpFilter, accessLogPathFilter)} disabled={isLoadingAccessLogs}>
                      {isLoadingAccessLogs ? '搜索中...' : '搜索'}
                    </Button>
                    <Button className="flex-1 sm:flex-none" variant="outline" onClick={() => { setAccessLogIpFilter(''); setAccessLogPathFilter(''); fetchAccessLogs(); }}>重置</Button>
                  </div>
                </div>
                <div className="max-h-[60vh] overflow-y-auto border rounded-md">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>时间</TableHead>
                        <TableHead>IP 地址</TableHead>
                        <TableHead>路径</TableHead>
                        <TableHead>状态码</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {isLoadingAccessLogs ? (
                        <TableRow><TableCell colSpan={4} className="text-center py-4">加载中...</TableCell></TableRow>
                      ) : accessLogs.length > 0 ? (
                        accessLogs.map((log) => (
                          <TableRow key={log.id}>
                            <TableCell className="text-xs sm:text-sm">{new Date(log.access_time).toLocaleString()}</TableCell>
                            <TableCell className="text-xs sm:text-sm">{log.ip_address}</TableCell>
                            <TableCell className="text-xs sm:text-sm break-all">{log.path}</TableCell>
                            <TableCell className={`text-xs sm:text-sm ${log.status_code >= 400 ? 'text-red-500' : 'text-green-500'}`}>{log.status_code}</TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TableRow><TableCell colSpan={4} className="text-center py-4">无访问日志</TableCell></TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={handleCleanupAccessLogs} className="text-black dark:text-white">清理7天前日志</Button>
                <SheetClose asChild>
                  <Button variant="outline">关闭</Button>
                </SheetClose>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Host Management Panel (Takes 2/3 width on large screens) */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>主机管理</CardTitle>
              <CardDescription>添加、编辑和管理您的Ansible主机。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <Dialog open={isBatchAddOpen} onOpenChange={setIsBatchAddOpen}>
                    <DialogTrigger asChild>
                      <Button><PlusCircledIcon className="mr-2 h-4 w-4" /> 批量添加主机</Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[600px] dialog-content-scroll-hide">
                      <DialogHeader>
                        <DialogTitle>批量添加主机</DialogTitle>
                        <DialogDescription>
                          每行输入一台主机信息，格式：
                          {useKeyAuth
                            ? "备注 地址 用户 端口"
                            : "备注 地址 用户 端口 SSH密码"}
                          。例如：<br />
                          <code>
                            {useKeyAuth
                              ? "us 192.168.1.1 root 22"
                              : "us 192.168.1.2 root 22 yourpassword"}
                          </code>
                        </DialogDescription>
                      </DialogHeader>
                      <div className="grid gap-4 py-4">
                        <Textarea
                          placeholder="需遵循示例格式输入"
                          rows={5} // Reduced rows
                          value={batchInput}
                          onChange={(e) => setBatchInput(e.target.value)}
                          className="placeholder:opacity-40 batch-input-textarea"
                        />
                      </div>
                      <DialogFooter>
                        <DialogClose asChild>
                          <Button type="button" variant="outline">取消</Button>
                        </DialogClose>
                        <Button type="button" onClick={handleAddHosts} disabled={isAddingHost}>
                          {isAddingHost ? '添加中...' : '确认添加'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center space-x-2">
                        <Switch id="key-auth-switch" checked={useKeyAuth} onCheckedChange={setUseKeyAuth} />
                        <Label htmlFor="key-auth-switch" className="cursor-pointer">
                          {useKeyAuth ? '密钥认证模式' : '密码认证模式'}
                        </Label>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>{useKeyAuth ? '新添加的主机将使用 /root/.ssh/id_rsa 路径的密钥认证' : '新添加的主机将使用密码认证'}</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
                <div className="flex gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm"
                        disabled={selectedHostIds.length === 0}
                        onClick={() => openPlaybookDialog('selected')}>
                        <PlayIcon className="mr-2 h-4 w-4" /> 执行任务
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>在选中的主机上执行自定义任务</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm"
                        disabled={selectedHostIds.length === 0}
                        onClick={() => openUploadDialog('selected')}>
                        <UploadIcon className="mr-2 h-4 w-4" /> 上传文件
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>上传文件到选中的主机</p></TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" onClick={handlePingAllHosts} disabled={isLoadingHosts || hosts.some(h => h.status === 'checking')}>
                        <ReloadIcon className={`mr-2 h-4 w-4 ${hosts.some(h => h.status === 'checking') ? 'animate-spin' : ''}`} /> Ping 所有
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent><p>检查所有主机的连通性</p></TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* Host List Table - Responsive Container */}
              <div className="border rounded-md overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[50px] px-2 sm:px-4">
                        <Checkbox
                          checked={isIndeterminate ? 'indeterminate' : isAllSelected}
                          onCheckedChange={handleSelectAllHosts}
                          aria-label="Select all hosts"
                        />
                      </TableHead>
                      <TableHead>备注</TableHead>
                      <TableHead>地址</TableHead>
                      <TableHead className="hidden md:table-cell">用户名</TableHead>
                      <TableHead className="hidden lg:table-cell">端口</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead className="text-right">操作</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoadingHosts ? (
                      <TableRow><TableCell colSpan={7} className="text-center py-4">加载中...</TableCell></TableRow>
                    ) : hosts.length > 0 ? (
                      hosts.map((host) => (
                        <TableRow key={host.id}>
                          <TableCell className="px-2 sm:px-4">
                            <Checkbox
                              checked={selectedHostIds.includes(host.id)}
                              onCheckedChange={(checked) => handleHostSelectionChange(host.id, !!checked)}
                              aria-label={`Select host ${host.id}`}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{host.comment}</TableCell>
                          <TableCell>{host.address}</TableCell>
                          <TableCell className="hidden md:table-cell">{host.username}</TableCell>
                          <TableCell className="hidden lg:table-cell">{host.port}</TableCell>
                          <TableCell>
                            <Tooltip>
                              <TooltipTrigger>
                                {host.status === 'checking' && <ReloadIcon className="h-4 w-4 animate-spin text-blue-500" />}
                                {host.status === 'success' && <CheckCircledIcon className="h-4 w-4 text-green-500" />}
                                {host.status === 'unreachable' && <CrossCircledIcon className="h-4 w-4 text-red-500" />}
                                {host.status === 'failed' && <InfoCircledIcon className="h-4 w-4 text-orange-500" />}
                                {!host.status && <span className="text-gray-400">-</span>}
                              </TooltipTrigger>
                              <TooltipContent>
                                {host.status === 'checking' && <p>检查中...</p>}
                                {host.status === 'success' && <p>连接成功</p>}
                                {host.status === 'unreachable' && <p>无法连接</p>}
                                {host.status === 'failed' && <p>检查失败</p>}
                                {!host.status && <p>未检查</p>}
                              </TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell className="text-right space-x-0.5 sm:space-x-1">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => handlePingHost(host.id)} disabled={host.status === 'checking'}>
                                  <ReloadIcon className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>Ping 主机</p></TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => openTerminal(host.id)}>
                                  <TerminalIcon className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>打开终端</p></TooltipContent>
                            </Tooltip>
                            <Dialog open={editingHost?.id === host.id} onOpenChange={(isOpen) => !isOpen && setEditingHost(null)}>
                              <DialogTrigger asChild>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon" onClick={() => handleEditHost(host)}>
                                      <Pencil1Icon className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent><p>编辑主机</p></TooltipContent>
                                </Tooltip>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-[425px]">
                                <DialogHeader>
                                  <DialogTitle>编辑主机: {editingHost?.comment}</DialogTitle>
                                  <DialogDescription>修改主机信息。留空密码字段则不更新密码。</DialogDescription>
                                </DialogHeader>
                                {editingHost && (
                                  <div className="grid gap-4 py-4">
                                    {/* Form fields remain the same */}
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-comment" className="text-right">备注</Label>
                                      <Input id="edit-comment" value={editingHost.comment} onChange={(e) => setEditingHost({ ...editingHost, comment: e.target.value })} className="col-span-3" />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-address" className="text-right">地址</Label>
                                      <Input id="edit-address" value={editingHost.address} onChange={(e) => setEditingHost({ ...editingHost, address: e.target.value })} className="col-span-3" />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-username" className="text-right">用户名</Label>
                                      <Input id="edit-username" value={editingHost.username} onChange={(e) => setEditingHost({ ...editingHost, username: e.target.value })} className="col-span-3" />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-port" className="text-right">端口</Label>
                                      <Input id="edit-port" type="number" value={editingHost.port} onChange={(e) => setEditingHost({ ...editingHost, port: parseInt(e.target.value, 10) || 22 })} className="col-span-3" />
                                    </div>
                                    <div className="grid grid-cols-4 items-center gap-4">
                                      <Label htmlFor="edit-auth-method" className="text-right">认证方式</Label>
                                      <div className="col-span-3 flex items-center space-x-2">
                                        <Switch
                                          id="edit-auth-method"
                                          checked={editingHost.auth_method === 'key'}
                                          onCheckedChange={(checked) => setEditingHost({ ...editingHost, auth_method: checked ? 'key' : 'password' })}
                                        />
                                        <Label htmlFor="edit-auth-method">{editingHost.auth_method === 'key' ? '密钥认证' : '密码认证'}</Label>
                                      </div>
                                    </div>
                                    {editingHost.auth_method === 'password' && (
                                      <div className="grid grid-cols-4 items-center gap-4">
                                        <Label htmlFor="edit-password" className="text-right">密码</Label>
                                        <Input id="edit-password" type="password" placeholder="留空则不修改" onChange={(e) => setEditingHost({ ...editingHost, password: e.target.value })} className="col-span-3" />
                                      </div>
                                    )}
                                  </div>
                                )}
                                <DialogFooter>
                                  <DialogClose asChild>
                                    <Button type="button" variant="outline">取消</Button>
                                  </DialogClose>
                                  <Button type="button" onClick={() => editingHost && handleSaveEdit(editingHost)} disabled={isEditingHost}>
                                    {isEditingHost ? '保存中...' : '保存更改'}
                                  </Button>
                                </DialogFooter>
                              </DialogContent>
                            </Dialog>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteHost(host.id)} className="text-red-500 hover:text-red-700">
                                  <TrashIcon className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent><p>删除主机</p></TooltipContent>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow><TableCell colSpan={7} className="text-center py-4">没有找到主机</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Command Execution Panel (Takes 1/3 width on large screens) */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>命令区域</CardTitle>
              <CardDescription>执行shell命令。</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 flex flex-col h-full">
              <div className="grid gap-2">
                <Label htmlFor="commandInput">输入命令</Label>
                <Textarea
                  id="commandInput"
                  placeholder="例如：ls /home"
                  rows={3} // Reduced rows
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  className="resize-y min-h-[80px] placeholder:opacity-40"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button className="flex-1 sm:flex-none" onClick={() => handleExecuteCommand('selected')} disabled={isExecutingCommand || selectedHostIds.length === 0}>
                  <PlayIcon className="mr-2 h-4 w-4" /> 发送到选中 ({selectedHostIds.length})
                </Button>
                <Button className="flex-1 sm:flex-none" onClick={() => handleExecuteCommand('all')} disabled={isExecutingCommand || hosts.length === 0}>
                  <PlayIcon className="mr-2 h-4 w-4" /> 发送到所有 ({hosts.length})
                </Button>
              </div>

              {/* Command Log Output - Takes remaining space */}
              <div className="flex flex-col flex-grow min-h-[200px]">
                <h3 className="text-lg font-semibold mb-2">执行日志</h3>
                <div className="border rounded-md p-3 flex-grow overflow-y-auto bg-muted/90 dark:bg-muted/90 text-sm font-mono whitespace-pre-wrap">
                  {commandLogs.length > 0 ? commandLogs.join('\n') : <span className="text-muted-foreground">暂无日志</span>}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* File Upload Dialog */}
        <Dialog open={isUploadDialogOpen} onOpenChange={setIsUploadDialogOpen}>
          <DialogContent className="sm:max-w-[525px]">
            <DialogHeader>
              <DialogTitle>文件上传</DialogTitle>
              <DialogDescription>
                选择文件并指定远程路径，然后上传到 {uploadTarget === 'all' ? '所有主机' : '选定主机'}。
              </DialogDescription>
            </DialogHeader>
            {uploadTarget && (
              <FileUpload
                targetHostIds={uploadTarget === 'all' ? 'all' : selectedHostIds}
                onUploadComplete={handleUploadComplete}
                onClose={() => setIsUploadDialogOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* Playbook Execution Dialog */}
        <Dialog open={isPlaybookDialogOpen} onOpenChange={setIsPlaybookDialogOpen}>
          <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto dialog-content-scroll-hide">
            <DialogHeader>
              <DialogTitle>执行Ansible Playbook</DialogTitle>
              <DialogDescription>
                在 {playbookTarget === 'all' ? '所有主机' : '选定主机'} 上执行自定义Playbook。
              </DialogDescription>
            </DialogHeader>

            {playbookTarget && (
              <PlaybookExecutor
                targetHostIds={playbookTarget === 'all' ? 'all' : selectedHostIds}
                onExecutionComplete={handlePlaybookComplete}
                onClose={() => setIsPlaybookDialogOpen(false)}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* GitHub Link */}
        <div className="text-center mt-6 mb-2">
          <a
            href="https://github.com/sky22333/ansible-ui"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors"
            title="GitHub仓库"
          >
            <Github size={16} />
          </a>
        </div>
      </div>
    </TooltipProvider>
  );
}

export default MainPage;


