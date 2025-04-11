import React from "react";

interface IProps {
  message: string;
  slug?: string;
}

export const ErrorMessage = ({ slug, message }: IProps) => {
  const className = slug ? `error-message ${slug}` : "error-message";
  const messageId = slug ? `${slug}-error` : "error";

  return (
    <div
      aria-live="assertive"
      className={className}
      data-testid={messageId}
      id={messageId}
      role="alert"
    >
      {message}
    </div>
  );
};
