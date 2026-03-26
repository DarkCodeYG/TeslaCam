import { readFileSync } from 'fs'

export interface TelemetryFrame {
  frameSeq: number
  speed: number        // km/h
  accelPedal: number   // 0~1
  steeringAngle: number // degrees
  blinkerLeft: boolean
  blinkerRight: boolean
  brakeApplied: boolean
  gear: number         // 0=P, 1=D, 2=R, 3=N
  autopilot: number    // 0=None, 1=FSD, 2=Autosteer, 3=TACC
  lat: number
  lon: number
  heading: number
  accelX: number
  accelY: number
  accelZ: number
}

function findMdat(buf: Buffer): { offset: number; size: number } | null {
  let pos = 0
  while (pos < buf.length - 8) {
    const size = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    if (type === 'mdat') {
      return { offset: pos + 8, size: size - 8 }
    }
    if (size < 8) break
    if (size === 1) {
      // 64-bit extended size
      const hi = buf.readUInt32BE(pos + 8)
      const lo = buf.readUInt32BE(pos + 12)
      pos += hi * 0x100000000 + lo
    } else {
      pos += size
    }
  }
  return null
}

function removeEmulationPrevention(data: Buffer): Buffer {
  const cleaned: number[] = []
  let i = 0
  while (i < data.length) {
    if (i + 2 < data.length && data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 3) {
      cleaned.push(0, 0)
      i += 3
    } else {
      cleaned.push(data[i])
      i++
    }
  }
  return Buffer.from(cleaned)
}

function decodeVarint(buf: Buffer, pos: number): [number, number] {
  let val = 0, shift = 0
  while (pos < buf.length) {
    const b = buf[pos++]
    val |= (b & 0x7F) << shift
    shift += 7
    if (!(b & 0x80)) break
  }
  return [val, pos]
}

function decodeProtobuf(data: Buffer): Record<number, number | boolean> {
  const fields: Record<number, number | boolean> = {}
  let pos = 0
  while (pos < data.length) {
    let tag: number
    ;[tag, pos] = decodeVarint(data, pos)
    const wireType = tag & 0x07
    const fieldNum = tag >> 3
    if (fieldNum === 0) continue

    if (wireType === 0) { // varint
      let val: number
      ;[val, pos] = decodeVarint(data, pos)
      fields[fieldNum] = val
    } else if (wireType === 1) { // 64-bit (double)
      if (pos + 8 > data.length) break
      fields[fieldNum] = data.readDoubleLE(pos)
      pos += 8
    } else if (wireType === 5) { // 32-bit (float)
      if (pos + 4 > data.length) break
      fields[fieldNum] = data.readFloatLE(pos)
      pos += 4
    } else {
      break
    }
  }
  return fields
}

export function extractTelemetry(filePath: string): TelemetryFrame[] {
  const buf = readFileSync(filePath)
  const mdat = findMdat(buf)
  if (!mdat) return []

  const frames: TelemetryFrame[] = []
  let offset = mdat.offset
  const end = mdat.offset + mdat.size

  while (offset < end - 4) {
    const nalLen = buf.readUInt32BE(offset)
    if (nalLen === 0 || nalLen > end - offset - 4) {
      offset++
      continue
    }

    const nalType = buf[offset + 4] & 0x1F
    if (nalType === 6) { // SEI
      let seiPos = offset + 5
      const nalEnd = offset + 4 + nalLen

      while (seiPos < nalEnd - 1) {
        // payload type
        let pt = 0
        while (seiPos < nalEnd && buf[seiPos] === 0xFF) { pt += 255; seiPos++ }
        if (seiPos >= nalEnd) break
        pt += buf[seiPos++]

        // payload size
        let ps = 0
        while (seiPos < nalEnd && buf[seiPos] === 0xFF) { ps += 255; seiPos++ }
        if (seiPos >= nalEnd) break
        ps += buf[seiPos++]

        if (pt === 5 && ps > 4) { // User Data Unregistered
          const payload = buf.subarray(seiPos, seiPos + ps)

          // Find 0x42...0x69 marker
          let mi = 0
          while (mi < payload.length && payload[mi] === 0x42) mi++
          if (mi > 0 && mi < payload.length && payload[mi] === 0x69) {
            let protoRaw = payload.subarray(mi + 1)

            // Remove RBSP trailing bits
            if (protoRaw.length > 0 && protoRaw[protoRaw.length - 1] === 0x80) {
              protoRaw = protoRaw.subarray(0, protoRaw.length - 1)
            }

            const cleaned = removeEmulationPrevention(Buffer.from(protoRaw))
            const fields = decodeProtobuf(cleaned)

            const rawSpeed = ((fields[4] as number) || 0) * 3.6
            const rawAccel = (fields[5] as number) || 0

            frames.push({
              frameSeq: (fields[3] as number) || 0,
              speed: (rawSpeed >= 0 && rawSpeed < 300) ? rawSpeed : 0,
              // >1.0 values are AP motor torque commands, not pedal position — discard
              accelPedal: (rawAccel >= 0 && rawAccel <= 1) ? rawAccel : 0,
              steeringAngle: (fields[6] as number) || 0,
              blinkerLeft: !!(fields[7]),
              blinkerRight: !!(fields[8]),
              brakeApplied: !!(fields[9]),
              gear: (fields[2] as number) || 0,
              autopilot: (fields[10] as number) || 0,
              lat: (fields[11] as number) || 0,
              lon: (fields[12] as number) || 0,
              heading: (fields[13] as number) || 0,
              accelX: (fields[14] as number) || 0,
              accelY: (fields[15] as number) || 0,
              accelZ: (fields[16] as number) || 0,
            })
          }
        }
        seiPos += ps
      }
    }
    offset += 4 + nalLen
  }

  return frames
}
