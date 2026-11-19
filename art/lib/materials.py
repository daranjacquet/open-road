"""Material library shared by all cars (names are what the game keys on)."""
from . import textures
from .util import material


def make(paint=0x1F4E9A, caliper=0xD4151B, extra=None):
    honey = textures.honeycomb()
    carbon_img = textures.carbon()
    tread_road = textures.tread_normal("tread_road", kind="road")
    tread_at = textures.tread_normal("tread_at", kind="at")
    plate_img = textures.plate()
    gauge_img = textures.gauges()
    m = {
        "paint": material("paint", paint, metallic=0.55, roughness=0.32, coat=1.0, coat_rough=0.04),
        "gap": material("gap", 0x060607, roughness=1.0, specular=0.0),
        "underbody": material("underbody", 0x0e0f10, roughness=1.0, specular=0.1),
        "well": material("well", 0x0a0b0c, roughness=1.0, specular=0.1),
        "trim_gloss": material("trim_gloss", 0x07080a, metallic=0.1, roughness=0.12, coat=0.6),
        "trim_matte": material("trim_matte", 0x141517, roughness=0.85, specular=0.3),
        "chrome": material("chrome", 0xe8ebf0, metallic=1.0, roughness=0.06),
        "satin_alu": material("satin_alu", 0xb9bec6, metallic=1.0, roughness=0.3),
        "carbon": material("carbon", 0x222222, metallic=0.2, roughness=0.22, coat=1.0, coat_rough=0.03, image=carbon_img),
        "glass": material("glass", 0x10161d, metallic=0.0, roughness=0.02, alpha=0.42),
        "glass_dark": material("glass_dark", 0x07090c, roughness=0.02, alpha=0.75),
        "glass_rubber": material("glass_rubber", 0x050505, roughness=0.7),
        "lens_clear": material("lens_clear", 0xe9eef5, roughness=0.02, alpha=0.12),
        "lens_red": material("lens_red", 0x9a0b10, roughness=0.05, alpha=0.78, emission=0x5a0000, emission_strength=0.6),
        "lens_amber": material("lens_amber", 0xff8a00, roughness=0.05, alpha=0.7),
        "reflector": material("reflector", 0xcfd4dc, metallic=1.0, roughness=0.12),
        "housing": material("housing", 0x8d939c, metallic=1.0, roughness=0.25),
        "led_white": material("led_white", 0xffffff, emission=0xeef4ff, emission_strength=6.0),
        "led_red": material("led_red", 0xff2020, emission=0xff0d0d, emission_strength=4.0),
        "led_amber": material("led_amber", 0xff9a1a, emission=0xff8a00, emission_strength=3.0),
        "honeycomb": material("honeycomb", 0x050505, roughness=0.6, image=honey, alpha_image=honey),
        "tire": material("tire", 0x121212, roughness=0.88, normal_image=tread_road),
        "tire_at": material("tire_at", 0x141414, roughness=0.92, normal_image=tread_at),
        "sidewall": material("sidewall", 0x161616, roughness=0.8),
        "rim": material("rim", 0x2b2e33, metallic=0.85, roughness=0.28),
        "rim_silver": material("rim_silver", 0xc9ced6, metallic=0.95, roughness=0.22),
        "rim_bronze": material("rim_bronze", 0x6b5536, metallic=0.9, roughness=0.3),
        "disc": material("disc", 0x5d6066, metallic=0.9, roughness=0.42),
        "caliper": material("caliper", caliper, metallic=0.2, roughness=0.35, coat=0.8),
        "plate": material("plate", 0xffffff, roughness=0.4, image=plate_img),
        "interior": material("interior", 0x1b1c1f, roughness=0.75),
        "leather": material("leather", 0x2a1c16, roughness=0.55),
        "alcantara": material("alcantara", 0x232428, roughness=0.95),
        "gauges": material("gauges", 0xffffff, roughness=0.3, image=gauge_img, emission=0x222222, emission_strength=0.3),
        "exhaust": material("exhaust", 0x8a8f96, metallic=1.0, roughness=0.25),
        "soot": material("soot", 0x050505, roughness=1.0),
        "rubber": material("rubber", 0x0b0b0b, roughness=0.9),
    }
    for k, v in (extra or {}).items():
        m[k] = v
    return m
