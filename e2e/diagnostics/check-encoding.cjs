/* 检查 provider-config.json 的字节与 UTF-8 解码内容 */
const fs = require('fs')
const path = require('path')
const os = require('os')

const file = path.join(os.homedir(), '.luobi', 'provider-config.json')
const buf = fs.readFileSync(file)

// 原始字节（前 200 字节的十六进制）
console.log('=== 文件字节（前120字节 hex） ===')
console.log(buf.subarray(0, 120).toString('hex'))

// UTF-8 解码
const text = buf.toString('utf8')
console.log('\n=== UTF-8 解码后的名称字段 ===')
const names = [...text.matchAll(/"name": "([^"]+)"/g)].map((m) => m[1])
console.log(JSON.stringify(names))

// 逐个检查是否有 BOM
console.log('\n=== BOM 检查 ===')
console.log('BOM:', buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf ? '有 BOM' : '无 BOM')
