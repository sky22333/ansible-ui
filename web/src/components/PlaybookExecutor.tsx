import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import api from '@/services/api';
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { CheckCircleIcon, XCircleIcon } from 'lucide-react';

interface PlaybookExecutorProps {
  targetHostIds: number[] | 'all';
  onExecutionComplete: () => void;
  onClose: () => void;
}

// 执行结果接口
interface PlaybookResult {
  success: boolean;
  return_code: number;
  logs: string[];
  summary: {
    success: string[];
    failed: string[];
    unreachable: string[];
  };
}

const defaultPlaybook = `---
# Ansible Playbook 示例
- name: 示例任务
  hosts: all
  tasks:
    - name: 执行一个简单的命令
      command: echo "Hello, Ansible!"
      register: hello_result
      
    - name: 显示命令结果
      debug:
        var: hello_result.stdout
`;

function PlaybookExecutor({ targetHostIds, onExecutionComplete, onClose }: PlaybookExecutorProps) {
  const [playbook, setPlaybook] = useState(defaultPlaybook);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState(0);
  const [executionResult, setExecutionResult] = useState<PlaybookResult | null>(null);

  const handleExecution = async () => {
    if (!playbook.trim()) {
      toast.error("错误", { description: "请输入Playbook内容" });
      return;
    }

    setIsExecuting(true);
    setExecutionProgress(10); // 开始进度
    setExecutionResult(null);

    try {
      // 准备请求数据
      const requestData = {
        playbook: playbook.trim(),
        host_ids: targetHostIds === 'all' ? [] : targetHostIds
      };

      // 发送请求执行Playbook
      setExecutionProgress(30);
      const response = await api.post<PlaybookResult>("/api/playbook/execute", requestData);
      setExecutionProgress(100);

      // 保存执行结果
      setExecutionResult(response.data);
      
      // 根据返回结果显示不同的消息
      if (response.data.success) {
        const successCount = response.data.summary.success.length;
        const failedCount = response.data.summary.failed.length;
        const unreachableCount = response.data.summary.unreachable.length;
        
        if (failedCount === 0 && unreachableCount === 0) {
          // 全部成功
          toast.success("Playbook执行成功", { 
            description: `成功执行Playbook，所有主机任务完成` 
          });
        } else {
          // 部分成功
          toast.warning("Playbook部分执行成功", { 
            description: `成功: ${successCount}台, 失败: ${failedCount}台, 不可达: ${unreachableCount}台` 
          });
        }
        
        // 不自动关闭对话框，让用户查看结果
        onExecutionComplete(); // 仅通知父组件执行完成
      } else {
        // 执行失败时的显示
        toast.error("Playbook执行失败", {
          description: `执行失败，返回代码: ${response.data.return_code}`,
        });
      }
    } catch (error) {
      console.error('Playbook execution failed:', error);
      const errorMsg = error instanceof Error 
        ? error.message 
        : ((error as any).response?.data?.message || (error as any).response?.data?.error || "发生未知错误");
      
      toast.error("Playbook执行失败", {
        description: errorMsg,
      });
    } finally {
      setIsExecuting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-2">
        <Label htmlFor="playbookContent">Playbook内容 (YAML格式)</Label>
        <Textarea 
          id="playbookContent" 
          placeholder="输入Ansible Playbook内容..." 
          value={playbook}
          onChange={(e) => setPlaybook(e.target.value)}
          className="font-mono text-sm min-h-[300px]"
          disabled={isExecuting}
        />
        <p className="text-xs text-muted-foreground">输入标准的Ansible Playbook格式，将对选中的主机执行。</p>
      </div>

      {isExecuting && (
        <Progress value={executionProgress} className="w-full" />
      )}

      {/* 执行结果显示区域 */}
      {executionResult && (
        <div className="border rounded-md p-3 bg-muted/90">
          <h4 className="text-sm font-medium mb-2">执行结果</h4>
          <p className="text-sm mb-2">
            {executionResult.success ? "Playbook执行成功" : "Playbook执行失败"} 
            (返回代码: {executionResult.return_code})
          </p>
          
          <div className="text-xs space-y-1 mb-3">
            {executionResult.summary.success.length > 0 && (
              <div>
                <p className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                  <CheckCircleIcon className="h-3 w-3" />
                  成功主机 ({executionResult.summary.success.length})
                </p>
                <ul className="pl-5 list-disc">
                  {executionResult.summary.success.map(host => (
                    <li key={`success-${host}`}>{host}</li>
                  ))}
                </ul>
              </div>
            )}
            
            {executionResult.summary.failed.length > 0 && (
              <div>
                <p className="font-medium text-red-600 dark:text-red-400 flex items-center gap-1 mt-2">
                  <XCircleIcon className="h-3 w-3" />
                  失败主机 ({executionResult.summary.failed.length})
                </p>
                <ul className="pl-5 list-disc">
                  {executionResult.summary.failed.map(host => (
                    <li key={`fail-${host}`}>{host}</li>
                  ))}
                </ul>
              </div>
            )}

            {executionResult.summary.unreachable.length > 0 && (
              <div>
                <p className="font-medium text-yellow-600 dark:text-yellow-400 flex items-center gap-1 mt-2">
                  <XCircleIcon className="h-3 w-3" />
                  不可达主机 ({executionResult.summary.unreachable.length})
                </p>
                <ul className="pl-5 list-disc">
                  {executionResult.summary.unreachable.map(host => (
                    <li key={`unreachable-${host}`}>{host}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="mt-4">
            <h5 className="text-sm font-medium mb-1">详细日志</h5>
            <div className="bg-black text-green-400 p-2 rounded font-mono text-xs h-[200px] overflow-y-auto whitespace-pre-wrap">
              {executionResult.logs.join('\n')}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
         <Button variant="outline" onClick={onClose} disabled={isExecuting}>
           {executionResult ? '关闭' : '取消'}
         </Button>
         {!executionResult && (
           <Button onClick={handleExecution} disabled={!playbook.trim() || isExecuting}>
             {isExecuting ? `执行中...` : '执行Playbook'}
           </Button>
         )}
         {executionResult && (
           <Button variant="default" onClick={onClose}>
             完成
           </Button>
         )}
      </div>
    </div>
  );
}

export default PlaybookExecutor; 