import bpy
bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
bpy.ops.wm.save_userpref()
import sys
mods=[m for m in sys.modules if m.endswith('mpfb.services.humanservice')]
print("MPFB modules:", mods)
