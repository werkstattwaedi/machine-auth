#pragma once

#include <functional>
#include <optional>
#include <tuple>

#include "common.h"

namespace oww::common {

template <typename... States>
class StateMachine;

template <typename... States>
class StateHandle;

template <typename... States>
class StateQuery {
 public:
  using State = typename StateMachine<States...>::State;

  StateQuery(std::function<bool(const State&)> fn) : fn_(fn) {}

  bool Matches(const StateMachine<States...>& sm) const {
    return fn_(sm.GetState());
  }

  bool Matches(const StateHandle<States...>& handle) const {
    return fn_(handle.captured_state_);
  }

 private:
  std::function<bool(const State&)> fn_;
};

template <typename... States>
class StateHandle {
  friend class StateMachine<States...>;
  friend class StateQuery<States...>;

 public:
  template <typename T>
  bool Is() const {
    return std::holds_alternative<T>(*captured_state_);
  }

  template <typename T>
  bool Exited() const {
    if (auto sm = state_machine_.lock()) {
      return Is<T>() && (!std::holds_alternative<T>(*sm->GetStatePtr()));
    }
    return true;
  }

  template <typename T>
  const T* Get() const {
    return std::get_if<T>(captured_state_.get());
  }

  // Compare with another StateHandle to detect transitions
  template <typename T>
  bool Entered(const StateHandle& previous) const {
    return Is<T>() && !previous.Is<T>();
  }

  template <typename T>
  bool Exited(const StateHandle& previous) const {
    return !Is<T>() && previous.Is<T>();
  }

 private:
  StateHandle(std::shared_ptr<const std::variant<States...>> captured_state,
              std::weak_ptr<const StateMachine<States...>> state_machine)
      : captured_state_(captured_state), state_machine_(state_machine) {}

  std::shared_ptr<const std::variant<States...>> captured_state_;
  std::weak_ptr<const StateMachine<States...>> state_machine_;
};

// Helper to get the index of a type in a parameter pack
template <typename T, typename... Ts>
struct type_index;

template <typename T, typename... Ts>
struct type_index<T, T, Ts...> : std::integral_constant<size_t, 0> {};

template <typename T, typename U, typename... Ts>
struct type_index<T, U, Ts...>
    : std::integral_constant<size_t, 1 + type_index<T, Ts...>::value> {};

template <typename... States>
class StateMachine
    : public std::enable_shared_from_this<StateMachine<States...>> {
 public:
  friend class StateHandle<States...>;
  using State = std::variant<States...>;
  using StateOpt = std::optional<State>;
  using Query = oww::common::StateQuery<States...>;
  using StateHandle = oww::common::StateHandle<States...>;

  template <typename T>
  using LoopFn = std::function<StateOpt(T&)>;

  template <typename InitialState, typename... Args>
  static std::shared_ptr<StateMachine<States...>> Create(
      std::in_place_type_t<InitialState>, Args&&... args) {
    struct MakeSharedEnabler : public StateMachine<States...> {
      MakeSharedEnabler(std::in_place_type_t<InitialState> in_place,
                        Args&&... args)
          : StateMachine(in_place, std::forward<Args>(args)...) {}
    };
    return std::make_shared<MakeSharedEnabler>(std::in_place_type<InitialState>,
                                               std::forward<Args>(args)...);
  }

  template <typename T>
  void OnLoop(LoopFn<T> fn) {
    std::get<LoopFn<T>>(loop_handlers_) = fn;
  }

  StateHandle Loop() {
    auto handle = StateHandle(current_state_, this->weak_from_this());

    StateOpt new_state = std::visit(
        [this](auto& state) -> StateOpt {
          using StateType = std::decay_t<decltype(state)>;
          auto& handler = std::get<LoopFn<StateType>>(loop_handlers_);
          if (handler) {
            return handler(state);
          }
          return std::nullopt;
        },
        *current_state_);

    if (new_state) {
      current_state_ = std::make_shared<State>(std::move(*new_state));
    }

    return handle;
  }

  // Add the new method here
  void TransitionTo(State&& new_state) {
    current_state_ = std::make_shared<State>(std::move(new_state));
  }

  StateHandle GetStateHandle() {
    return StateHandle(current_state_, this->weak_from_this());
  }

  const State& GetState() const { return *current_state_; }
  std::shared_ptr<const State> GetStatePtr() const { return current_state_; }

  template <typename T>
  bool Is() const {
    return std::holds_alternative<T>(*current_state_);
  }

  template <typename T>
  bool Entered(StateHandle& last_state) const {
    auto sm = last_state.state_machine_.lock();
    if (sm.get() == this) {
      return Is<T>() && !last_state.template Is<T>();
    }
    return false;
  }

  template <typename T>
  bool Exited(StateHandle& last_state) const {
    auto sm = last_state.state_machine_.lock();
    if (sm.get() == this) {
      return !Is<T>() && last_state.template Is<T>();
    }
    return false;
  }

  template <typename T>
  const T* Get() const {
    return std::get_if<T>(current_state_.get());
  }

 protected:
  template <typename InitialState, typename... Args>
  StateMachine(std::in_place_type_t<InitialState>, Args&&... args)
      : current_state_(std::make_shared<State>(std::in_place_type<InitialState>,
                                               std::forward<Args>(args)...)) {}

 private:
  std::shared_ptr<State> current_state_;
  std::tuple<LoopFn<States>...> loop_handlers_;
};

}  // namespace oww::common
