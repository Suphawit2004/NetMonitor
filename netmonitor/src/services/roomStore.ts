import type { Room } from '../types'
import { ROOMS_F1, ROOMS_F2 } from '../data/mockData'

const DEFAULT_ROOMS: Record<1 | 2, Room[]> = {
  1: ROOMS_F1,
  2: ROOMS_F2,
}

/**
 * อ่านผังห้องจาก LocalStorage โดยตรง (หากไม่มีข้อมูลให้คืนค่า mock rooms)
 */
export function readRawRooms(floor: 1 | 2): Room[] {
  try {
    const saved = localStorage.getItem(`netmonitor:custom_rooms_f${floor}`)
    if (saved !== null) {
      const parsed = JSON.parse(saved)
      if (Array.isArray(parsed)) {
        return parsed
      }
    }
  } catch (e) { console.warn('roomStore', e) }
  return DEFAULT_ROOMS[floor]
}

/**
 * ดึงผังห้องที่บันทึกไว้สำหรับชั้นที่ระบุ พร้อมซิงค์บันไดเชื่อมต่อระหว่างชั้นอัตโนมัติ
 * "ในกรณีที่วางไว้แล้ว ให้โชว์บันไดในอีกชั้นด้วย"
 */
export function getStoredRooms(floor: 1 | 2): Room[] {
  const currentRooms = readRawRooms(floor)
  const targetFloor: 1 | 2 = floor === 1 ? 2 : 1
  const otherRooms = readRawRooms(targetFloor)

  const otherStairs = otherRooms.filter(r => r.type === 'stairs' || /บันได|stairs/i.test(r.label))
  const currentStairs = currentRooms.filter(r => r.type === 'stairs' || /บันได|stairs/i.test(r.label))

  // กรณีที่อีกชั้นหนึ่งมีบันไดอยู่แล้ว (เช่น วางไว้ที่ชั้น 1 แล้ว) แต่ชั้นนี้ยังไม่มี
  // ให้ยกบันไดจากอีกชั้นมาแสดงที่ตำแหน่งและขนาดเดียวกันทันที
  if (otherStairs.length > 0 && currentStairs.length === 0) {
    const synced: Room[] = [...currentRooms]
    for (const stair of otherStairs) {
      synced.push({
        ...stair,
        label: stair.label || 'บันได',
        type: 'stairs',
        connectsToFloor: targetFloor,
      })
    }
    saveStoredRooms(floor, synced)
    return synced
  }

  // กรณีที่ทั้งสองชั้นมีบันไดอยู่แล้ว ให้ซิงค์พิกัดและขนาดให้ตรงกันกับชั้นต้นทาง
  if (otherStairs.length > 0 && currentStairs.length > 0) {
    const partner = otherStairs[0]
    let diff = false
    const synced: Room[] = currentRooms.map(r => {
      const isStair = r.type === 'stairs' || /บันได|stairs/i.test(r.label)
      if (!isStair) return r
      if (
        r.left !== partner.left ||
        r.top !== partner.top ||
        r.width !== partner.width ||
        r.height !== partner.height ||
        r.connectsToFloor !== targetFloor
      ) {
        diff = true
        return {
          ...r,
          type: 'stairs' as const,
          left: partner.left,
          top: partner.top,
          width: partner.width,
          height: partner.height,
          connectsToFloor: targetFloor,
        }
      }
      return r
    })
    if (diff) {
      saveStoredRooms(floor, synced)
      return synced
    }
  }

  return currentRooms
}

/**
 * บันทึกผังห้องที่ปรับแต่งลง LocalStorage
 */
export function saveStoredRooms(floor: 1 | 2, rooms: Room[]): void {
  try {
    localStorage.setItem(`netmonitor:custom_rooms_f${floor}`, JSON.stringify(rooms))
  } catch (e) { console.warn('roomStore', e) }
}

/**
 * รีเซ็ตผังห้องทั้งหมดให้เป็นกรอบอาคารว่างเปล่า (0 ห้อง)
 */
export function resetStoredRooms(floor: 1 | 2): Room[] {
  const empty: Room[] = []
  try {
    localStorage.setItem(`netmonitor:custom_rooms_f${floor}`, JSON.stringify(empty))
  } catch (e) { console.warn('roomStore', e) }
  return empty
}

/**
 * ซิงค์ตำแหน่งและมิติของบันไดข้ามชั้น (เชื่อมต่อระหว่างชั้น 1 และชั้น 2)
 */
export function syncStairsAcrossFloors(sourceFloor: 1 | 2, sourceStairs: Room): void {
  const targetFloor = sourceFloor === 1 ? 2 : 1
  const targetRooms = [...readRawRooms(targetFloor)]
  const existingIdx = targetRooms.findIndex(r => r.type === 'stairs' || /บันได|stairs/i.test(r.label))

  if (existingIdx >= 0) {
    targetRooms[existingIdx] = {
      ...targetRooms[existingIdx],
      label: targetRooms[existingIdx].label || sourceStairs.label || 'บันได',
      type: 'stairs',
      left: sourceStairs.left,
      top: sourceStairs.top,
      width: sourceStairs.width,
      height: sourceStairs.height,
      connectsToFloor: sourceFloor,
    }
  } else {
    targetRooms.push({
      label: sourceStairs.label || 'บันได',
      type: 'stairs',
      left: sourceStairs.left,
      top: sourceStairs.top,
      width: sourceStairs.width,
      height: sourceStairs.height,
      connectsToFloor: sourceFloor,
    })
  }

  saveStoredRooms(targetFloor, targetRooms)
}

/**
 * ลบบันไดเชื่อมต่อในอีกชั้นออก เมื่อบันไดในชั้นต้นทางถูกลบ
 */
export function removeStairsAcrossFloors(sourceFloor: 1 | 2): void {
  const targetFloor = sourceFloor === 1 ? 2 : 1
  const targetRooms = readRawRooms(targetFloor)
  const remaining = targetRooms.filter(r => !(r.type === 'stairs' || /บันได|stairs/i.test(r.label)))
  saveStoredRooms(targetFloor, remaining)
}


