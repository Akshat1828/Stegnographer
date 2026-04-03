import numpy as np
from PIL import Image
import zlib
import hashlib
import random
import struct
import math
import os
import base64
from cryptography.fernet import Fernet

def get_cipher(password):
    # Derive a 32-byte key from the password to use with Fernet
    key = hashlib.sha256(password.encode('utf-8')).digest()
    b64_key = base64.urlsafe_b64encode(key)
    return Fernet(b64_key)

# Generate a Warnsdorff's Knight's Tour for an 8x8 block (0-63 sequence)
def generate_8x8_tour(start_pixel=0):
    board = [[-1 for _ in range(8)] for _ in range(8)]
    moves = [(2, 1), (1, 2), (-1, 2), (-2, 1), (-2, -1), (-1, -2), (1, -2), (2, -1)]
    r, c = start_pixel // 8, start_pixel % 8
    board[r][c] = 0
    route = [(r, c)]
    for step in range(1, 64):
        min_deg = 9
        next_r, next_c = -1, -1
        # Randomize moves order slightly for uniqueness or keep standard, keeping standard Warnsdorff
        for dr, dc in moves:
            nr, nc = r + dr, c + dc
            if 0 <= nr < 8 and 0 <= nc < 8 and board[nr][nc] == -1:
                # Count degree
                count = sum(1 for ddr, ddc in moves if 0 <= nr+ddr < 8 and 0 <= nc+ddc < 8 and board[nr+ddr][nc+ddc] == -1)
                if count < min_deg:
                    min_deg = count
                    next_r, next_c = nr, nc
        r, c = next_r, next_c
        board[r][c] = step
        route.append((r, c))
    return [r * 8 + c for r, c in route]

def get_capacity(width, height, lsb_count=1):
    """Returns the maximum amount of encodable bytes (after compression)"""
    nx, ny = width // 8, height // 8
    total_blocks = nx * ny
    # Each block is 64 pixels, 3 channels = 192 bits. With lsb_count bits, capacity increases.
    # 192 bits = 24 bytes.
    return total_blocks * 24 * lsb_count

def build_pixel_sequence(width, height, password):
    nx, ny = width // 8, height // 8
    total_blocks = nx * ny
    
    # Hash password to get a reliable standard PRNG seed
    h = hashlib.sha256(password.encode()).digest()
    seed = int.from_bytes(h, "big")
    rng = random.Random(seed)
    
    # Generate the unique Knight's Tour path for this password
    start_pixel = rng.randint(0, 63)
    tour_8x8 = generate_8x8_tour(start_pixel)
    
    block_indices = list(range(total_blocks))
    rng.shuffle(block_indices)
    
    return block_indices, nx, ny, tour_8x8

def get_pixel_coords(block_idx, nx, ny, step_in_block, tour_8x8):
    # From block index, get block X and Y
    bx = block_idx % nx
    by = block_idx // nx
    
    # From step in block, get which pixel in the 8x8 tour
    pixel_idx = tour_8x8[step_in_block]
    px = pixel_idx % 8
    py = pixel_idx // 8
    
    abs_x = bx * 8 + px
    abs_y = by * 8 + py
    return abs_x, abs_y

def encode(cover_image_path, secret_bytes, ext, password, output_path, lsb_count=1, progress_callback=None):
    def report(step, name, pct):
        if progress_callback:
            progress_callback(step, name, pct)

    report(1, "Compressing your file", 5)
    img = Image.open(cover_image_path)
    icc_profile = img.info.get('icc_profile')  # Preserve ICC profile before conversion
    img = img.convert('RGB')
    width, height = img.size
    pixels = np.array(img, dtype=np.uint8)
    
    # Compress only if it actually helps
    compressed_attempt = zlib.compress(secret_bytes, level=9)
    if len(compressed_attempt) < len(secret_bytes):
        raw_payload = compressed_attempt
        is_compressed = 1
    else:
        raw_payload = secret_bytes
        is_compressed = 0
    report(1, "Compressing your file", 20)
    
    # Encrypt the payload and mathematically lock it
    cipher = get_cipher(password)
    enc_payload_b64 = cipher.encrypt(raw_payload)
    # Strip the 33% textual Base64 bloat down to pure raw binary bytes for maximum efficiency!
    enc_payload = base64.urlsafe_b64decode(enc_payload_b64)
    report(2, "Encrypting your file", 30)
    
    # Build payload: [ext_len:1][ext:n][flags:1][data_len:4][data]
    # flags bit 0: 1 = zlib compressed, 0 = raw
    ext_bytes = ext.encode('utf-8')
    ext_len = len(ext_bytes)
    data_len = len(enc_payload)
    
    payload = struct.pack(f'>B{ext_len}sBi', ext_len, ext_bytes, is_compressed, data_len) + enc_payload
    payload_bits = np.unpackbits(np.frombuffer(payload, dtype=np.uint8))
    total_bits = len(payload_bits)
    report(2, "Structuring your file", 40)
    
    max_bytes = get_capacity(width, height, lsb_count) - 1
    if total_bits > max_bytes * 8:
        raise ValueError(f"Payload too large. Max capacity with selected depth is {max_bytes} bytes, but requires {math.ceil(total_bits/8)} bytes.")
    
    block_indices, nx, ny, tour_8x8 = build_pixel_sequence(width, height, password)
    report(2, "Generating Spatial Path", 50)
    
    # Embed (lsb_count-1) into the first pixel's two LSBs so 0=1bit,1=2bits,2=3bits
    meta_val = lsb_count - 1  # 0, 1, or 2
    abs_x, abs_y = get_pixel_coords(block_indices[0], nx, ny, 0, tour_8x8)
    pixels[abs_y, abs_x, 0] = int((pixels[abs_y, abs_x, 0] & 254) | ((meta_val >> 1) & 1))
    pixels[abs_y, abs_x, 1] = int((pixels[abs_y, abs_x, 1] & 254) | (meta_val & 1))
    
    bit_idx = 0
    done = False
    
    mask = 255 - ((1 << lsb_count) - 1)  # If lsb_count=1, mask=254. If 2, mask=252.
    total_blocks = len(block_indices)
    
    for i, block_idx in enumerate(block_indices):
        if done:
            break
        
        # Report progress every 5% of blocks
        if i % max(1, total_blocks // 20) == 0:
            pct = 50 + int((i / total_blocks) * 45)
            report(3, "Hiding your file", pct)
        
        start_step = 1 if i == 0 else 0
        for step in range(start_step, 64):
            if done:
                break
            abs_x, abs_y = get_pixel_coords(block_idx, nx, ny, step, tour_8x8)
            # Encode in RGB
            for channel in range(3):
                if bit_idx < total_bits:
                    val = 0
                    for _ in range(lsb_count):
                        if bit_idx < total_bits:
                            val = (val << 1) | payload_bits[bit_idx]
                            bit_idx += 1
                        else:
                            val = (val << 1) # pad
                    
                    pixels[abs_y, abs_x, channel] = int((pixels[abs_y, abs_x, channel] & mask) | (val & ((1 << lsb_count) - 1)))
                else:
                    done = True
                    break

    report(3, "Hiding your file", 97)
    encoded_img = Image.fromarray(pixels)
    if icc_profile:
        encoded_img.save(output_path, "PNG", icc_profile=icc_profile)
    else:
        encoded_img.save(output_path, "PNG")
    report(3, "Hiding your file", 100)

def decode(stego_image_path, password, progress_callback=None):
    def report(step, name, pct):
        if progress_callback:
            progress_callback(step, name, pct)

    report(1, "Extracting from image", 5)
    img = Image.open(stego_image_path).convert('RGB')
    width, height = img.size
    pixels = np.array(img, dtype=np.uint8)
    
    block_indices, nx, ny, tour_8x8 = build_pixel_sequence(width, height, password)
    report(1, "Mapping Pixel Path", 20)
    
    # Extract lsb_count from the first pixel of the first block (stored as lsb_count-1)
    abs_x, abs_y = get_pixel_coords(block_indices[0], nx, ny, 0, tour_8x8)
    bit2 = int(pixels[abs_y, abs_x, 0]) & 1
    bit1 = int(pixels[abs_y, abs_x, 1]) & 1
    meta_val = (bit2 << 1) | bit1
    lsb_count = meta_val + 1  # 0->1, 1->2, 2->3
    
    total_blocks = len(block_indices)
    
    def bit_generator():
        for i, block_idx in enumerate(block_indices):
            if i % max(1, total_blocks // 20) == 0:
                pct = 20 + int((i / total_blocks) * 50)
                report(2, "Decrypting data", pct)
            start_step = 1 if i == 0 else 0
            for step in range(start_step, 64):
                abs_x, abs_y = get_pixel_coords(block_idx, nx, ny, step, tour_8x8)
                for channel in range(3):
                    pixel_val = pixels[abs_y, abs_x, channel]
                    for i in range(lsb_count - 1, -1, -1):
                        yield (pixel_val >> i) & 1
    
    gen = bit_generator()
    
    def read_bytes(n):
        byte_list = []
        for _ in range(n):
            byte_val = 0
            for i in range(8):
                try:
                    bit = next(gen)
                except StopIteration:
                    return None
                byte_val = (byte_val << 1) | bit
            byte_list.append(byte_val)
        return bytes(byte_list)
        
    # Read ext length (1 byte)
    ext_len_bytes = read_bytes(1)
    if not ext_len_bytes:
        raise Exception("Failed to decode: Data corrupted or wrong password.")
    ext_len = struct.unpack('>B', ext_len_bytes)[0]
    
    # Read ext string
    ext_bytes = read_bytes(ext_len)
    if not ext_bytes:
        raise Exception("Failed to decode: Data corrupted or wrong password.")
    try:
        ext = ext_bytes.decode('utf-8')
    except:
        raise Exception("Failed to decode: Invalid extension. Wrong password?")

    # Read flags byte (bit 0: 1=compressed, 0=raw)
    flags_bytes = read_bytes(1)
    if not flags_bytes:
        raise Exception("Failed to decode.")
    is_compressed = struct.unpack('>B', flags_bytes)[0] & 1

    # Read data length (4 bytes, signed to match struct pack 'i')
    data_len_bytes = read_bytes(4)
    if not data_len_bytes:
        raise Exception("Failed to decode.")
    data_len = struct.unpack('>i', data_len_bytes)[0]
    
    # Sanity check on data_len
    if data_len > get_capacity(width, height, lsb_count) or data_len < 0:
        raise Exception("Failed to decode: Corrupted payload length. Wrong password?")
    
    
    report(3, "Decrypting Data", 75)
    enc_payload_data = read_bytes(data_len)
    if not enc_payload_data:
        raise Exception("Failed to decode: Data corrupted or wrong password.")
        
    # Decrypt AES Cryptography
    cipher = get_cipher(password)
    try:
        # Re-apply the base64 textual mask to our raw binary payload so Fernet can digest and unlock it
        enc_payload_b64 = base64.urlsafe_b64encode(enc_payload_data)
        raw_payload = cipher.decrypt(enc_payload_b64)
    except Exception:
        raise Exception("Failed to decode: Invalid Password. Cryptographic unlock failed.")

    if is_compressed:
        try:
            secret_bytes = zlib.decompress(raw_payload)
        except zlib.error:
            raise Exception("Failed to decode: Decompression failed.")
    else:
        secret_bytes = raw_payload
    
    report(3, "Finished Decoding", 100)
    return secret_bytes, ext