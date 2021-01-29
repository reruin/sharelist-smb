const request = require('request')
const os = require('os')
const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

// const TMP_CHACHE_PATH = path.join(os.tmpdir(), '_sharelist_cache_')

// fs.mkdirSync(TMP_CHACHE_PATH, { recursive: true })


/**
 * 
 */
class Rectifier extends EventEmitter {
  constructor(options, size , offset = 0) {
    super()
    this.options = options
    this.offset = offset
    this.size = size
    this.buffers = []
    this.position = offset
    this.tasks = []
    this.loaded = false
    this.running = false
    this.closed = false
    this.paused = false

    this.length = 0
    this.cacheSize = Math.max( Math.round(size / 10) , 2 * 1024 * 1024) // 至少向前加载2M

  }

  reset(){
    this.tasks = []
    this.loaded = false
    this.running = false
  }

  when(position, cb) {
    if( this.closed ) return

    this.tasks.push([position, cb])

    if( !this.running ){
      this.start()
      this.running = true
    }

    this.updateTask()
  }

  updateTask() {
    let { position, tasks , size , cacheSize } = this

    //预读取
    let farestChunk = Math.max(...tasks.map(i => i[0]),0)
    // console.log('position',position,farest)

    if( position - farestChunk > this.cacheSize ){
      this.req.pause()
      this.paused = true
    }else if(position - farestChunk < this.cacheSize / 5 ){
      if( this.paused ){
        this.req.resume()
        this.paused = false
      }
    }

    let undone = []
    for(let i of tasks){
      let [p , cb] = i
      if( p <= position ){
        cb(this)
      }else if( p > size ){
        if( this.loaded ){
          cb(this)
        }else{
          undone.push(i)
        }
      }else{
        undone.push(i)
      }
    }

    this.tasks = undone

  }

  /**
   * 从缓冲区读取指定大小的块
   * 要求 SMB Reader 必须顺序读取（实测属实）
   *
   * @param {number} size: 大小
   * @param {number} offset: 起始位置
   */
  read(buffer, offset, length, position, cb){
    // //末尾不足size
    if( length > this.length ) length = this.length

    let b
    let index = offset
    let flag = false

    while (null != (b = this.buffers.shift())) {
      for (let i = 0; i < b.length; i++) {
        buffer[index++] = b[i]
        if (index == length) {//填充完毕
          this.length -= length
          b = b.slice(i + 1)
          this.buffers.unshift(b)
          flag = true
          break
        }
      }
      if( flag ) break
    }

    cb(null, length , buffer)
  }

  //  从start处 开始获取流
  start() {
    let req = request({ ...this.options, encoding: null })
    req.on('response', (response) => {

      //不支持 range
      if( response.statusCode != 206 ){
        this.offset = 0
        this.position = 0
      }

      response.on('data', (chunk) => {
        let bytesRead = chunk.length

        this.buffers.push(chunk.slice(0))

        //缓冲区实际长度
        this.length += bytesRead

        //当前下载指针
        this.position += bytesRead

        this.updateTask()
      })

      response.on('end', () => {
        this.loaded = true
        this.updateTask()
      })
    })

    this.req = req
  }

  close(cb) {
    this.tasks = []
    this.loaded = false
    this.closed = true
    if(this.req) {
      this.req.abort()
      cb()
    }
  }
}

const closeFile = (file , cb) => {
  if(file.rectifier){
    file.rectifier.close(cb)
    file.rectifier = null
  }else if( file.fd ){
    fs.close(file.fd, function (err) {
      file.fd = undefined;
      cb(err)
    });
  }
}

const readFile = (file, buffer, offset, length, position, cb) => {
  let data = file.stats
  let { outputType = 'url', size } = data
  if (outputType === 'url') {
    if (!file.fd) {

      let extra = data.proxy_options || {}
      let headers = {}
      let range = `bytes=${position}-`

      if (data.proxy_headers) {
        for (let i in data.proxy_headers) {
          headers[i] = data.proxy_headers[i]
        }
      }

      headers.range = range
      file.rectifier = new Rectifier({ url: data.url, headers, ...extra }, size , position)
    }
    //要读取的block末端位置
    file.rectifier.when(position + length, (rectifier) => {
      // console.log('READ: '+length,position+'-'+(position+length),'\r\n')
      rectifier.read(buffer, offset, length, position, cb)
    })
  } else if(outputType === 'file') {
    if( file.fd ){
      // console.log('READ: '+length,position+'-'+(position+length),'\r\n')
      fs.read(file.fd, buffer, offset, length, position, cb);
    }else{
      fs.open(data.url, 'r', (err,fd) => {
        if( err ){
          cb('unable to get file descriptor due to unexpeced error')
        }else{
          file.fd = fd
          fs.read(fd, buffer, offset, length, position, cb);
        }
      })
    }
  } else {
    cb('unsupport type')
  }
}


module.exports.readFile = readFile
module.exports.closeFile = closeFile