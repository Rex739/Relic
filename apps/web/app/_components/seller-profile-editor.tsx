"use client";

import { ImageIcon, Save } from "lucide-react";
import type { ReactNode } from "react";
import { useState, useTransition } from "react";

import { Button } from "../../components/ui/button";
import { labelForCategory } from "../../lib/marketplace";

type SellerProfileAgent = {
  agentId: string;
  name: string;
  description: string;
  imageUrl: string | null;
  serviceEndpoint?: string | null;
  serviceId: string | null;
  category: string;
};

const MAX_IMAGE_SIZE = 2 * 1024 * 1024;
const PROFILE_IMAGE_SIZE = 1024;

const cropProfileImage = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The image could not be read."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () =>
        reject(new Error("The selected file is not a valid image."));
      image.onload = () => {
        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
        const sourceX = Math.round((image.naturalWidth - sourceSize) / 2);
        const sourceY = Math.round((image.naturalHeight - sourceSize) / 2);
        const canvas = document.createElement("canvas");
        canvas.width = PROFILE_IMAGE_SIZE;
        canvas.height = PROFILE_IMAGE_SIZE;
        const context = canvas.getContext("2d");
        if (context === null) {
          reject(new Error("Image processing is unavailable in this browser."));
          return;
        }
        context.drawImage(
          image,
          sourceX,
          sourceY,
          sourceSize,
          sourceSize,
          0,
          0,
          PROFILE_IMAGE_SIZE,
          PROFILE_IMAGE_SIZE,
        );
        resolve(canvas.toDataURL("image/jpeg", 0.86));
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });

export function SellerProfileEditor({
  agent,
  action,
  offerAction,
  serviceAction,
  verificationAction,
}: {
  agent: SellerProfileAgent;
  action: (formData: FormData) => Promise<{ error: string | null }>;
  offerAction?: ReactNode;
  serviceAction?:
    | ((formData: FormData) => Promise<{ error: string | null }>)
    | undefined;
  verificationAction?:
    | (() => Promise<{ error: string | null; queued?: boolean }>)
    | undefined;
}) {
  const [pending, startTransition] = useTransition();
  const [imageUrl, setImageUrl] = useState(agent.imageUrl ?? "");
  const [savedImageUrl, setSavedImageUrl] = useState(agent.imageUrl ?? "");
  const [description, setDescription] = useState(agent.description);
  const [savedDescription, setSavedDescription] = useState(agent.description);
  const [serviceEndpoint, setServiceEndpoint] = useState(
    agent.serviceEndpoint ?? "",
  );
  const [savedServiceEndpoint, setSavedServiceEndpoint] = useState(
    agent.serviceEndpoint ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [verificationMessage, setVerificationMessage] = useState<string | null>(null);
  const hasChanges =
    imageUrl !== savedImageUrl ||
    description !== savedDescription ||
    serviceEndpoint !== savedServiceEndpoint;

  return (
    <section className="profile-section seller-profile-editor">
      <div className="section-heading">
        <div>
          <span className="overline">Marketplace profile</span>
          <h2>{agent.name}</h2>
        </div>
        <span className="seller-profile-category">
          {labelForCategory(agent.category)}
        </span>
      </div>
      <p className="seller-profile-note">
        This buyer-facing profile is managed by the verified owner. The original
        ERC-8004 metadata remains unchanged.
      </p>
      <form
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            setSaved(false);
            if (
              serviceEndpoint !== savedServiceEndpoint &&
              serviceAction !== undefined
            ) {
              const result = await serviceAction(formData);
              if (result.error !== null) {
                setError(result.error);
                return;
              }
            }
            if (imageUrl !== savedImageUrl || description !== savedDescription) {
              const result = await action(formData);
              if (result.error !== null) {
                setError(result.error);
                return;
              }
            }
            setSavedImageUrl(imageUrl);
            setSavedDescription(description);
            setSavedServiceEndpoint(serviceEndpoint);
            setSaved(true);
          })
        }
        className="seller-profile-form"
      >
        <input name="imageUrl" type="hidden" value={imageUrl} />
        <input name="serviceEndpoint" type="hidden" value={serviceEndpoint} />
        <div className="seller-profile-image-preview">
          {imageUrl === "" ? (
            <ImageIcon aria-hidden="true" size={24} />
          ) : (
            <img alt="" src={imageUrl} />
          )}
        </div>
        <div className="seller-profile-fields">
          <label>
            Profile image
            <input
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => {
                const file = event.target.files?.[0];
                setImageError(null);
                if (file === undefined) return;
                if (file.size > MAX_IMAGE_SIZE) {
                  setImageError("Choose an image smaller than 2 MB.");
                  event.target.value = "";
                  return;
                }
                void cropProfileImage(file)
                  .then((croppedImage) => setImageUrl(croppedImage))
                  .catch((caught) =>
                    setImageError(
                      caught instanceof Error
                        ? caught.message
                        : "The image could not be prepared.",
                    ),
                  );
              }}
              type="file"
            />
            <small>
              Square (1:1) works best; use at least 512 × 512 px. Images are
              center-cropped to a square and must be under 2 MB.
            </small>
            {imageError !== null ? (
              <small role="alert">{imageError}</small>
            ) : null}
          </label>
          {imageUrl !== "" ? (
            <button
              className="seller-image-reset"
              onClick={() => setImageUrl("")}
              type="button"
            >
              Use the original profile image
            </button>
          ) : null}
          <label>
            Service endpoint
            <input
              disabled={agent.serviceId === null}
              onChange={(event) => setServiceEndpoint(event.target.value)}
              placeholder="https://your-agent.example.com"
              type="url"
              value={serviceEndpoint}
            />
            <small>
              Use the public HTTPS endpoint buyers will reach. Changing it
              triggers a fresh Relic verification.
            </small>
          </label>
          <label>
            Description
            <textarea
              maxLength={2000}
              minLength={20}
              name="description"
              onChange={(event) => setDescription(event.target.value)}
              required
              rows={6}
              value={description}
            />
          </label>
          <div className="seller-profile-actions">
            <Button disabled={pending || !hasChanges} type="submit">
              <Save aria-hidden="true" size={16} />
              {pending ? "Saving…" : "Save profile"}
            </Button>
            {verificationAction === undefined ? null : (
              <Button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    setError(null);
                    setVerificationMessage(null);
                    const result = await verificationAction();
                    if (result.error !== null) {
                      setError(result.error);
                      return;
                    }
                    setVerificationMessage(
                      result.queued === false
                        ? "Verification was already requested. Try again in a few minutes."
                        : "Verification requested. Relic will update this listing when the check finishes.",
                    );
                  })
                }
                type="button"
                variant="outline"
              >
                {pending ? "Requesting…" : "Request verification"}
              </Button>
            )}
            {offerAction}
            {saved ? <span role="status">Profile saved</span> : null}
            {verificationMessage !== null ? (
              <span role="status">{verificationMessage}</span>
            ) : null}
            {error !== null ? <span role="alert">{error}</span> : null}
          </div>
        </div>
      </form>
    </section>
  );
}
