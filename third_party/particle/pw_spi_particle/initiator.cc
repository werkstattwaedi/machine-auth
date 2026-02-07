// Copyright Offene Werkstatt Wädenswil
// SPDX-License-Identifier: MIT

#include "pb_spi/initiator.h"

#include "pw_assert/check.h"
#include "pw_log/log.h"
#include "spi_hal.h"

namespace pb {

// Static member initialization
std::array<ParticleSpiInitiator*, ParticleSpiInitiator::kMaxInterfaces>
    ParticleSpiInitiator::active_instances_ = {nullptr, nullptr, nullptr};

namespace {

// Convert our Interface enum to HAL interface type
hal_spi_interface_t ToHalInterface(ParticleSpiInitiator::Interface interface) {
  switch (interface) {
    case ParticleSpiInitiator::Interface::kSpi:
      return HAL_SPI_INTERFACE1;
    case ParticleSpiInitiator::Interface::kSpi1:
      return HAL_SPI_INTERFACE2;
    case ParticleSpiInitiator::Interface::kSpi2:
      return HAL_SPI_INTERFACE3;
  }
  PW_UNREACHABLE;
}

// Convert pw::spi::Config to HAL SPI mode (0-3)
uint8_t ToHalSpiMode(
    pw::spi::ClockPolarity polarity, pw::spi::ClockPhase phase
) {
  // SPI Mode mapping:
  // Mode 0: CPOL=0 (ActiveHigh), CPHA=0 (RisingEdge)
  // Mode 1: CPOL=0 (ActiveHigh), CPHA=1 (FallingEdge)
  // Mode 2: CPOL=1 (ActiveLow),  CPHA=0 (RisingEdge)
  // Mode 3: CPOL=1 (ActiveLow),  CPHA=1 (FallingEdge)
  const uint8_t cpol =
      (polarity == pw::spi::ClockPolarity::kActiveLow) ? 0x02 : 0x00;
  const uint8_t cpha =
      (phase == pw::spi::ClockPhase::kFallingEdge) ? 0x01 : 0x00;
  return cpol | cpha;
}

size_t InterfaceIndex(ParticleSpiInitiator::Interface interface) {
  return static_cast<size_t>(interface);
}

}  // namespace

// Static DMA completion callbacks - route to the registered instance.
// These must be static functions because the HAL callback has no user data
// parameter. Each interface has its own callback that looks up the instance
// from the class-static registry.
void ParticleSpiInitiator::DmaCallback0() {
  if (active_instances_[0] != nullptr) {
    active_instances_[0]->dma_complete_.release();
  }
}

void ParticleSpiInitiator::DmaCallback1() {
  if (active_instances_[1] != nullptr) {
    active_instances_[1]->dma_complete_.release();
  }
}

void ParticleSpiInitiator::DmaCallback2() {
  if (active_instances_[2] != nullptr) {
    active_instances_[2]->dma_complete_.release();
  }
}

void (*ParticleSpiInitiator::GetDmaCallback(Interface interface))() {
  switch (interface) {
    case Interface::kSpi:
      return DmaCallback0;
    case Interface::kSpi1:
      return DmaCallback1;
    case Interface::kSpi2:
      return DmaCallback2;
  }
  PW_UNREACHABLE;
}

ParticleSpiInitiator::ParticleSpiInitiator(
    Interface interface, uint32_t clock_hz, SpiFlags flags
)
    : interface_(interface), clock_hz_(clock_hz), flags_(flags) {
  const size_t index = InterfaceIndex(interface_);
  PW_CHECK(
      active_instances_[index] == nullptr,
      "SPI interface %zu already has an active initiator",
      index
  );
  active_instances_[index] = this;
}

ParticleSpiInitiator::~ParticleSpiInitiator() {
  if (initialized_) {
    hal_spi_end(ToHalInterface(interface_));
  }
  active_instances_[InterfaceIndex(interface_)] = nullptr;
}

pw::Status ParticleSpiInitiator::DoConfigure(const pw::spi::Config& config) {
  const hal_spi_interface_t hal_interface = ToHalInterface(interface_);

  // Initialize SPI if not already done
  if (!initialized_) {
    hal_spi_init(hal_interface);

    // Convert SpiFlags to HAL flags
    uint32_t hal_flags = 0;
    if (flags_ & SpiFlags::kMosiOnly) {
      hal_flags |= HAL_SPI_CONFIG_FLAG_MOSI_ONLY;
    }

    // Begin in master mode with no default CS pin (we manage CS externally)
    if (hal_flags != 0) {
      hal_spi_config_t spi_config = {};
      spi_config.size = sizeof(spi_config);
      spi_config.version = HAL_SPI_CONFIG_VERSION;
      spi_config.flags = hal_flags;
      hal_spi_begin_ext(
          hal_interface, SPI_MODE_MASTER, SPI_DEFAULT_SS, &spi_config);
    } else {
      hal_spi_begin_ext(hal_interface, SPI_MODE_MASTER, SPI_DEFAULT_SS, nullptr);
    }
    initialized_ = true;
  }

  // Calculate clock divider from target frequency
  const int divider =
      hal_spi_get_clock_divider(hal_interface, clock_hz_, nullptr);
  if (divider < 0) {
    PW_LOG_ERROR(
        "Failed to calculate SPI clock divider for %u Hz",
        static_cast<unsigned>(clock_hz_)
    );
    return pw::Status::InvalidArgument();
  }

  // Convert config to HAL parameters
  const uint8_t bit_order =
      (config.bit_order == pw::spi::BitOrder::kMsbFirst) ? MSBFIRST : LSBFIRST;
  const uint8_t spi_mode = ToHalSpiMode(config.polarity, config.phase);

  // Apply settings (set_default=0 means apply immediately)
  const int32_t result = hal_spi_set_settings(
      hal_interface,
      /*set_default=*/0,
      static_cast<uint8_t>(divider),
      bit_order,
      spi_mode,
      nullptr
  );

  if (result != 0) {
    PW_LOG_ERROR(
        "hal_spi_set_settings failed with %d", static_cast<int>(result)
    );
    return pw::Status::Internal();
  }

  return pw::OkStatus();
}

pw::Status ParticleSpiInitiator::DoWriteRead(
    pw::ConstByteSpan write_buffer, pw::ByteSpan read_buffer
) {
  if (!initialized_) {
    return pw::Status::FailedPrecondition();
  }

  const hal_spi_interface_t hal_interface = ToHalInterface(interface_);

  // Determine transfer length (max of write and read)
  const size_t transfer_len = std::max(write_buffer.size(), read_buffer.size());

  if (transfer_len == 0) {
    return pw::OkStatus();
  }

  // Start DMA transfer
  // Note: For write-only transfers (display), rx_buffer is nullptr
  // For read-only transfers, tx_buffer can be nullptr (will send 0x00)
  hal_spi_transfer_dma(
      hal_interface,
      write_buffer.empty() ? nullptr : write_buffer.data(),
      read_buffer.empty() ? nullptr : read_buffer.data(),
      static_cast<uint32_t>(transfer_len),
      GetDmaCallback(interface_)
  );

  // Calculate timeout based on transfer size and clock frequency.
  // Time = (bytes * 8 bits) / clock_hz, with 2x margin + 10ms minimum overhead.
  const uint32_t transfer_time_us =
      static_cast<uint32_t>((transfer_len * 8 * 1'000'000) / clock_hz_);
  const uint32_t timeout_ms =
      std::max<uint32_t>(transfer_time_us / 500, 10);  // 2x margin
  const auto dma_timeout = pw::chrono::SystemClock::for_at_least(
      std::chrono::milliseconds(timeout_ms)
  );

  if (!dma_complete_.try_acquire_for(dma_timeout)) {
    PW_LOG_ERROR("SPI DMA transfer timed out");
    hal_spi_transfer_dma_cancel(hal_interface);

    // Drain any stale semaphore releases from previous timed-out transfers.
    dma_complete_.try_acquire();

    // Late callback will be drained at start of next transfer
    return pw::Status::DeadlineExceeded();
  }

  return pw::OkStatus();
}

}  // namespace pb
