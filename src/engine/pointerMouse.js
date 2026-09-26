// Feeds `devices.js`'s INT 33h driver model from the browser (docs/engine.md §9cu): pointer movement
// as mickeys (`movementX/Y`, one per CSS pixel -- `UNKNOWN_mouse_host_scale`), and the left/right
// buttons. While a MOUSE reader is in use, a click on the canvas takes the pointer lock, so the
// movement keeps coming at the window's edge, as a real mouse's would.

/** `isActive()`: whether any player's device is MOUSE right now. Returns a detach function. */
export function attachMouseDriver(driver, target, canvas, isActive) {
  const onButtons = (e) => { driver.buttons = ((e.buttons & 1) ? 1 : 0) | ((e.buttons & 2) ? 2 : 0) }
  // A second button pressed while one is held arrives as a pointermove (a pointer-event chord).
  const onMove = (e) => { onButtons(e); if (isActive()) driver.move(e.movementX ?? 0, e.movementY ?? 0) }
  const onClick = () => { if (isActive() && canvas?.requestPointerLock && canvas.ownerDocument?.pointerLockElement !== canvas) canvas.requestPointerLock() }
  const onContext = (e) => { if (isActive()) e.preventDefault() } // the right button is BRAKE
  target.addEventListener('pointermove', onMove)
  target.addEventListener('pointerdown', onButtons)
  target.addEventListener('pointerup', onButtons)
  canvas?.addEventListener('click', onClick)
  canvas?.addEventListener('contextmenu', onContext)
  return () => {
    target.removeEventListener('pointermove', onMove)
    target.removeEventListener('pointerdown', onButtons)
    target.removeEventListener('pointerup', onButtons)
    canvas?.removeEventListener('click', onClick)
    canvas?.removeEventListener('contextmenu', onContext)
  }
}
