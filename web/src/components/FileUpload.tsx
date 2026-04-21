import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { UploadCloudIcon, FileIcon, XIcon, CheckCircleIcon, XCircleIcon } from 'lucide-react';
import { toast } from "sonner";
import api from '@/services/api';
import { getApiErrorMessage } from '@/utils/http';

interface FileUploadProps {
  targetHostIds: number[] | 'all';
  onClose: () => void;
}

interface UploadResult {
  success: boolean;
  message: string;
  details?: {
    succeeded: string[];
    failed: Record<string, string>;
  };
}

function FileUpload({ targetHostIds, onClose }: FileUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [remotePath, setRemotePath] = useState('/tmp/');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
      setUploadProgress(0);
      setUploadResult(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
  });

  const handleUpload = async () => {
    if (!file) {
      toast.error("错误", { description: "请先选择一个文件" });
      return;
    }
    if (!remotePath.trim()) {
      toast.error("错误", { description: "请输入远程服务器上的目标路径" });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    setUploadResult(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('remote_path', remotePath.trim());
    formData.append('hosts', JSON.stringify(targetHostIds));

    try {
      const response = await api.post<UploadResult>("/api/upload", formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (progressEvent) => {
          const percentCompleted = Math.round((progressEvent.loaded * 100) / (progressEvent.total || 1));
          setUploadProgress(percentCompleted);
        },
      });

      setUploadResult(response.data);
      if (response.data.success) {
        const details = response.data.details;
        const succeededCount = details?.succeeded.length || 0;
        const failedCount = Object.keys(details?.failed || {}).length;
        
        if (failedCount === 0) {
          toast.success("文件上传成功", { 
            description: `文件已成功上传到所有目标主机的 ${remotePath}` 
          });
        } else {
          toast.warning("文件部分上传成功", { 
            description: `成功: ${succeededCount}台, 失败: ${failedCount}台. 查看详情以了解更多信息。` 
          });
        }
      } else {
        toast.error("文件上传失败", {
          description: response.data.message || "所有主机上传失败",
        });
      }
    } catch (error) {
      console.error('File upload failed:', error);
      const errorMsg = getApiErrorMessage(error);

      toast.error("文件上传失败", {
        description: errorMsg,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const removeFile = () => {
    setFile(null);
    setUploadProgress(0);
    setUploadResult(null);
  };

  return (
    <div className="space-y-4">
      <div 
        {...getRootProps()} 
        className={`border-2 border-dashed rounded-md p-6 text-center cursor-pointer ${isDragActive ? 'border-primary bg-primary/10' : 'border-gray-300 dark:border-gray-700 hover:border-gray-400 dark:hover:border-gray-600'}`}
      >
        <input {...getInputProps()} />
        <UploadCloudIcon className="mx-auto h-12 w-12 text-gray-400" />
        {isDragActive ? (
          <p className="mt-2 text-sm text-primary">将文件拖到此处...</p>
        ) : (
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">将文件拖放到此处，或点击选择文件</p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-500">仅支持单个文件上传</p>
      </div>

      {file && (
        <div className="border rounded-md p-3 flex items-center justify-between bg-muted/50">
          <div className="flex items-center gap-2">
            <FileIcon className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium truncate max-w-[200px]" title={file.name}>{file.name}</span>
            <span className="text-xs text-muted-foreground">({(file.size / 1024).toFixed(2)} KB)</span>
          </div>
          <Button variant="ghost" size="icon" onClick={removeFile} disabled={isUploading}>
            <XIcon className="h-4 w-4" />
          </Button>
        </div>
      )}

      {isUploading && (
        <Progress value={uploadProgress} className="w-full" />
      )}

      <div className="grid gap-2">
        <Label htmlFor="remotePath">远程路径</Label>
        <Input 
          id="remotePath" 
          placeholder="例如: /tmp/ 或 /home/user/" 
          value={remotePath}
          onChange={(e) => setRemotePath(e.target.value)}
          disabled={isUploading}
        />
        <p className="text-xs text-muted-foreground">文件将被上传到目标主机的这个目录下。</p>
      </div>

      {uploadResult && (
        <div className="border rounded-md p-3 bg-muted/90">
          <h4 className="text-sm font-medium mb-2">上传结果</h4>
          <p className="text-sm mb-2">{uploadResult.message}</p>
          
          {uploadResult.details && (
            <div className="text-xs space-y-1 max-h-40 overflow-y-auto">
              {uploadResult.details.succeeded.length > 0 && (
                <div>
                  <p className="font-medium text-green-600 dark:text-green-400 flex items-center gap-1">
                    <CheckCircleIcon className="h-3 w-3" />
                    成功 ({uploadResult.details.succeeded.length})
                  </p>
                  <ul className="pl-5 list-disc">
                    {uploadResult.details.succeeded.map(hostId => (
                      <li key={`success-${hostId}`}>主机 ID: {hostId}</li>
                    ))}
                  </ul>
                </div>
              )}
              
              {Object.keys(uploadResult.details.failed).length > 0 && (
                <div>
                  <p className="font-medium text-red-600 dark:text-red-400 flex items-center gap-1 mt-2">
                    <XCircleIcon className="h-3 w-3" />
                    失败 ({Object.keys(uploadResult.details.failed).length})
                  </p>
                  <ul className="pl-5">
                    {Object.entries(uploadResult.details.failed).map(([hostId, errorMsg]) => (
                      <li key={`fail-${hostId}`} className="mb-1">
                        <span className="font-medium">主机 ID: {hostId}</span>
                        <p className="text-red-500 dark:text-red-400">{errorMsg}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-end gap-2">
         <Button variant="outline" onClick={onClose} disabled={isUploading}>
           {uploadResult ? '关闭' : '取消'}
         </Button>
         {!uploadResult && (
           <Button onClick={handleUpload} disabled={!file || isUploading || !remotePath.trim()}>
             {isUploading ? `上传中... (${uploadProgress}%)` : '开始上传'}
           </Button>
         )}
         {uploadResult && uploadResult.success && (
           <Button variant="default" onClick={onClose}>
             完成
           </Button>
         )}
      </div>
    </div>
  );
}

export default FileUpload;

