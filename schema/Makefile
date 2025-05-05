# --- Configuration ---
FLATBUFFERS_REPO_DIR := flatbuffers
FLATBUFFER_COMPILER := $(FLATBUFFERS_REPO_DIR)/flatc
FIRMWARE_CPP_OUT_DIR := ../firmware/src/fbs
CLOUDFUNCTIONS_TS_OUT_DIR := ../functions/src/fbs

# --- Helper Variables ---
CPP_SCHEMAS := $(wildcard ./*.fbs)
TS_SCHEMAS := $(wildcard ./*.fbs)

# --- Targets ---
all: flatc cpp_code ts_code

flatc: $(FLATBUFFER_COMPILER)

$(FLATBUFFER_COMPILER):
	@echo "Building FlatBuffers compiler..."
	@cd $(FLATBUFFERS_REPO_DIR) && cmake -DCMAKE_BUILD_TYPE=Release
	@cd $(FLATBUFFERS_REPO_DIR) && make flatc -j
	@echo "FlatBuffers compiler built."

cpp_code: flatc
	@echo "Generating C++ FlatBuffers code..."
	@mkdir -p $(FIRMWARE_CPP_OUT_DIR)
	@for schema in $(CPP_SCHEMAS); do \
		$(FLATBUFFER_COMPILER) --cpp  --gen-object-api --cpp-include common.h --cpp-std c++17 -o $(FIRMWARE_CPP_OUT_DIR) $$schema; \
	done
	@echo "C++ FlatBuffers code generated in $(FIRMWARE_CPP_OUT_DIR)"


ts_code: flatc
	@echo "Generating TypeScript FlatBuffers code..."
	@mkdir -p $(CLOUDFUNCTIONS_TS_OUT_DIR)
	@for schema in $(TS_SCHEMAS); do \
		$(FLATBUFFER_COMPILER) --ts  --gen-object-api -o $(CLOUDFUNCTIONS_TS_OUT_DIR) $$schema; \
	done
	@echo "C++ FlatBuffers code generated in $(FIRMWARE_CPP_OUT_DIR)"

clean:
	@echo "Cleaning generated FlatBuffers code and build files..."
	@rm -rf $(FIRMWARE_CPP_OUT_DIR)
	@rm -rf $(CLOUDFUNCTIONS_TS_OUT_DIR)
	@rm -rf $(FLATBUFFER_BUILD_DIR)
	@echo "Clean complete."

.PHONY: all flatc cpp_code ts_code clean